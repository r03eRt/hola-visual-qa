# Feature: page-readiness-policy

Roadmap item #9 (Browser MVP). Tracking issue: #19.

## Goal

A deterministic, configurable **readiness/stabilization policy** applied to a
page before a visual snapshot, implementing every SPEC-003 policy: wait for DOM
readiness + a configured app-ready signal, wait for fonts, disable animations
(Playwright `emulateMedia` + narrow CSS, honoring `VisualPolicy.animations`),
trigger controlled lazy-loading by scrolling, optionally freeze time ONLY for
pages that explicitly support it, and expose the declared dynamic **mask
selectors** so reports can include them. **No arbitrary long sleeps** as the
primary readiness mechanism; a readiness timeout reports **which** condition
did not complete. Testable WITHOUT a real browser (DI structural page
interface, like #6-#8).

## Context and canonical references

- `docs/specs/SPEC-003-PAGE-STABILITY.md` — the policy list and acceptance
  criteria: repeated runs on a deterministic fixture produce identical
  screenshots; a true layout change still fails; a readiness timeout reports
  which condition did not complete.
- `src/config/schema.ts` — `VisualPolicy.animations` (`'disabled' | 'allow'`)
  is honored here. No new config fields in this PR.
- `src/stability/prepare-page.ts` — LEGACY scaffold (`emulateMedia`,
  `document.fonts.ready`, animation-off CSS, and a `waitForTimeout(500)` that
  VIOLATES "no arbitrary long sleeps"). Replace its behavior with a proper
  policy in NEW files; do NOT modify or import the legacy file (the visual
  scaffold still imports it until #10 rewires).
- `src/domain/error.ts` — `normalizeError` with `category: 'readiness_timeout'`,
  phase `readiness`.
- The existing visual scaffold masks `[data-visual-mask]`; keep that as the
  default declared mask selector.

## Non-goals

- No screenshot/visual assertion (#10), no diagnostics capture (#12), no
  navigation, no orchestration.
- Do NOT modify `src/config/*`, `src/domain/*`, `src/scenarios/*`,
  `src/browser/*`, `src/consent/*`, `src/stability/prepare-page.ts`,
  `playwright.config.ts`, or `tests/visual/*`. ADDITIVE: new files under
  `src/stability/` only.
- Do NOT add readiness/mask fields to the config schema (policy options with
  defaults; a config-driven version is a later additive change).
- Do NOT make the `tests/unit` suite launch a real browser.

## Proposed interfaces and files (new, under `src/stability/`)

- `src/stability/page-like.ts`
  - Minimal DI structural `StabilityPageLike` covering only what the policy
    uses (a real Playwright `Page` satisfies it):
    `waitForLoadState(state: 'domcontentloaded' | 'load' | 'networkidle',
    options?: { timeout?: number }): Promise<void>`;
    `waitForFunction(pageFunction, arg?, options?: { timeout?: number }):
    Promise<unknown>`;
    `emulateMedia(options: { reducedMotion?: 'reduce' | 'no-preference' }):
    Promise<void>`;
    `addStyleTag(options: { content: string }): Promise<unknown>`;
    `evaluate<R>(pageFunction, arg?): Promise<R>`.
- `src/stability/policy.ts`
  - `interface ReadinessPolicy { waitForDomState: 'domcontentloaded' | 'load';
    appReadyExpression?: string; waitForFonts: boolean; animations: 'disabled' |
    'allow'; lazyLoad: { enabled: boolean; steps: number }; freezeTime: boolean;
    maskSelectors: string[]; timeoutMs: number; }`.
  - `DEFAULT_READINESS_POLICY` (waitForDomState `'load'`, waitForFonts true,
    animations `'disabled'`, lazyLoad `{ enabled: true, steps: 8 }`, freezeTime
    false, maskSelectors `['[data-visual-mask]']`, timeoutMs e.g. `10_000`).
  - `readinessPolicyFromConfig(config: ProjectConfig, overrides?:
    Partial<ReadinessPolicy>): ReadinessPolicy` — maps `VisualPolicy.animations`
    into the policy; overrides win.
  - `appReadyExpression` is a boolean JS expression string evaluated in-page
    (e.g. `"window.__APP_READY__ === true"`); omitted → the app-ready wait is
    skipped.
- `src/stability/readiness.ts`
  - `interface ReadinessResult { steps: ReadinessStep[]; maskSelectors:
    string[]; timeFrozen: boolean; }` where `ReadinessStep` is a named record of
    what ran (e.g. `'dom'`, `'app-ready'`, `'fonts'`, `'animations'`,
    `'lazy-load'`, `'freeze-time'`) with `ran: boolean`.
  - `preparePage(page: StabilityPageLike, policy?: ReadinessPolicy):
    Promise<ReadinessResult>` — runs, IN ORDER:
    1. `waitForLoadState(policy.waitForDomState)`.
    2. if `appReadyExpression`: `waitForFunction(<expr>)` (bounded by
       `timeoutMs`).
    3. if `waitForFonts`: `waitForFunction("document.fonts.status === 'loaded'")`
       (bounded).
    4. if `animations === 'disabled'`: `emulateMedia({ reducedMotion: 'reduce'
       })` + `addStyleTag` with narrow CSS that disables animations/transitions
       and hides caret (the SPEC-003 "narrow CSS injection"). Do NOT hide
       arbitrary elements — masking is selector-declared, applied at snapshot
       time by #10, not here.
    5. if `lazyLoad.enabled`: a single `evaluate` that scrolls the document in
       `steps` increments awaiting `requestAnimationFrame`, then returns to top
       — deterministic, NO `waitForTimeout`.
    6. if `freezeTime`: only when the page reports support via
       `evaluate("typeof window.__VISUAL_QA_FREEZE_TIME__ === 'function'")`;
       then `evaluate("window.__VISUAL_QA_FREEZE_TIME__()")`. Sets
       `timeFrozen` accordingly; when unsupported, skip (do not throw).
  - Each awaited condition is wrapped so a timeout/rejection throws a normalized
    `readiness_timeout` error (phase `readiness`) whose message NAMES the failing
    condition (e.g. "app-ready signal", "fonts", "DOM load"). No secrets in the
    message.
  - `resolveMaskSelectors(policy): string[]` — returns the declared mask
    selectors for inclusion in reports (the actual locator masking happens in
    #10).
- `src/stability/index.ts` — barrel for the new modules (do NOT re-export the
  legacy `prepare-page.ts`).

## Acceptance criteria

- [ ] `preparePage` performs the SPEC-003 steps IN ORDER and records each in
      `ReadinessResult.steps`; it uses NO `waitForTimeout` as a readiness
      mechanism (signal/`waitForFunction`/`evaluate`-rAF based only).
- [ ] Animations are disabled (emulateMedia reduce + narrow CSS) when
      `animations === 'disabled'` and NOT touched when `'allow'`.
- [ ] Fonts and the app-ready signal are awaited only when configured, each
      bounded by `timeoutMs`.
- [ ] Lazy-load performs a bounded, deterministic scroll of `steps` increments
      and returns to top; time freeze runs ONLY when the page reports support,
      reflected by `ReadinessResult.timeFrozen`.
- [ ] A timeout in any condition throws a normalized `readiness_timeout` (phase
      `readiness`) whose message identifies which condition failed.
- [ ] `resolveMaskSelectors`/`ReadinessResult.maskSelectors` expose the declared
      selectors (default `['[data-visual-mask]']`) for reports.
- [ ] `readinessPolicyFromConfig` maps `VisualPolicy.animations` and applies
      overrides.
- [ ] `npm run typecheck` and `npm run lint` exit 0; `npm run test:unit` passes
      and launches NO browser; `docs/STATUS.md` stabilization row updated
      honestly.

## Test plan

- `tests/unit/page-readiness-policy.spec.ts` (Playwright `test` runner, DI, NO
  real browser — mirror `tests/unit/consent-state-verification.spec.ts`). Use a
  fake `StabilityPageLike` recording the ordered method calls and letting a test
  script a specific call to reject (to simulate a timeout). Cover EVERY
  acceptance bullet: ordered steps; animations on/off by policy; fonts/app-ready
  gating; lazy-load step count + return-to-top; freeze-time supported vs
  unsupported; the named `readiness_timeout` throw per condition; mask selectors
  exposure; `readinessPolicyFromConfig` mapping/overrides. Assert NO
  `waitForTimeout` is part of the interface/used.
- Verify: `npm run typecheck` → 0, `npm run lint` → 0, `npm run test:unit` → all
  pass (no browser). Do NOT run the visual suite.

## Security/privacy impact

None. No navigation, no secrets. Readiness error messages name conditions only
(no page content). `appReadyExpression`/freeze hooks are caller/policy-provided,
not derived from secrets.

## Baseline impact

Indirect but important: this defines how pages are stabilized before snapshots,
so it must be deterministic. #10 will consume it. No baselines are created here.

## Dependencies and risks

- Depends on #2 (config) and #3 (domain), merged; DI style from #6-#8.
- Risk: replacing the legacy `waitForTimeout` with signal-based waits could hang
  if a signal never fires → every wait is bounded by `timeoutMs` and reports the
  failing condition.
- Risk: over-hiding via CSS could mask real regressions → CSS only disables
  animations/transitions/caret; element hiding is left to declared masks in #10.

## Handover notes

Well-scoped for Sonnet 5. Keep the unit suite hermetic via DI. Write the
"named readiness_timeout per condition" and "ordered steps / no waitForTimeout"
tests FIRST (`skills/superpowers/test-driven-development`), commit frequently,
and run `skills/superpowers/verification-before-completion` before the PR
(`Closes #19`). Escalate to Opus if a policy option needs to become a
config-schema field, or if masking must be applied here rather than exposed for
#10.
