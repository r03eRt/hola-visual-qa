# Feature: e2e-visual-baseline

## Goal

Close the end-to-end visual run for the stable default QA target
(`https://example.com`): expose per-project mask selectors in config, generate
and human-review the FIRST baselines, commit them with a written reason, and
prove a green visual run.

## Context and linked canonical specs

- `docs/STATUS.md` "End-to-end visual run wiring" (#29) — the wired flow this
  feature finally exercises with committed baselines.
- `docs/DEMO.md` — the run guide, extended here with the demonstrated target and
  its caveats.
- `docs/specs/SPEC-003-PAGE-STABILITY.md` — readiness/mask policy the new config
  field feeds.
- `src/config/schema.ts` (`VisualPolicySchema`), `src/stability/policy.ts`
  (`readinessPolicyFromConfig`) — where masks are now config-driven.
- `baselines/README.md`, `docs/features/baseline-update-command/SPEC.md` — the
  reviewed-baseline commit convention and audit log.

## Non-goals

- webkit/firefox baselines — those browsers are not installable in the current
  macOS 13 environment; their baselines are a documented follow-up.
- CI-linux baseline regeneration — the committed PNGs are chromium/local renders;
  the gated `visual` CI job stays gated until linux baselines land.
- Per-scenario baseline differentiation — consent/ads variants currently share
  one `baselineName` (they render identically on `example.com`); this is recorded
  as a known limitation, not fixed here.
- Any change to the execution engine, JSON/HTML API, or the dashboard.

## Proposed interfaces and files

- `src/config/schema.ts`: `VisualPolicySchema` gains
  `maskSelectors: z.array(z.string().min(1)).default(['[data-visual-mask]'])`
  (strict object, backward compatible via the default).
- `src/stability/policy.ts`: `readinessPolicyFromConfig` maps
  `config.visual.maskSelectors` into the returned `ReadinessPolicy`
  (explicit overrides still win). The visual spec already spreads
  `workItem.readiness.maskSelectors` into every `toHaveScreenshot` `mask`.
- `baselines/desktop-chromium/full-page-chromium-ci-desktop.png`,
  `baselines/mobile-chromium/full-page-chromium-ci-mobile.png`: the first
  reviewed baselines (public static Example Domain page).
- `baselines/UPDATE_LOG.jsonl`: one reasoned, secret-free audit line for the
  baseline creation.
- `docs/DEMO.md`, `docs/STATUS.md`: document the demonstrated target, the green
  run, and the follow-up scope.

## Acceptance criteria

- [x] `config.visual.maskSelectors` exists (default `['[data-visual-mask]']`) and
  flows into `readinessPolicyFromConfig` → the visual spec's `mask` locators.
- [x] First baselines for both chromium projects are generated against
  `https://example.com`, human-reviewed and committed under `baselines/`.
- [x] A visual run for the chromium projects passes green against the committed
  baselines (no `--update`).
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` pass, including new
  assertions that `maskSelectors` defaults and maps from config.
- [x] `baselines/UPDATE_LOG.jsonl` carries a reasoned, secret-free audit line.
- [x] `docs/STATUS.md` + `docs/DEMO.md` reflect the demonstrated target and the
  webkit/firefox + CI-linux follow-up.

## Test plan

- Unit: `tests/unit/page-readiness-policy.spec.ts` — `maskSelectors` default and
  a custom `['.ad-slot', '#carousel']` mapping through
  `readinessPolicyFromConfig`. Existing `VisualPolicy` literals across the suite
  updated for the new required field.
- Manual (local, real browser via `CHROMIUM_EXECUTABLE_PATH` → Chromium.app):
  `--update-snapshots` to seed, human review of both PNGs, then a clean run —
  **8 passed / 8 skipped** across the two chromium projects.

## Security/privacy impact

Baselines are committed PNGs of a public static page (`example.com`) — no
credentials, auth state, cookies or production content. The snapshot change
carries a written reason (commit + `UPDATE_LOG.jsonl`) and was human-approved
before commit, per `AGENTS.md`. `maskSelectors` is a declarative CSS-selector
list; masking only hides regions from comparison and introduces no execution or
injection surface.

## Baseline impact

Creates the project's FIRST two committed baselines (chromium desktop + mobile).
No existing baseline is overwritten. Future legitimate visual changes still
require a written reason and human review.

## Dependencies and risks

- Cross-platform rendering: the committed baselines are local Chromium (darwin)
  renders. A linux CI run may diff on antialiasing; the `visual` CI job stays
  gated until linux baselines are generated and reviewed there.
- Shared `baselineName` across consent/ads variants means those variants are not
  visually differentiated yet (fine for `example.com`; a follow-up should
  partition baselines per scenario for sites where consent changes the page).
- macOS 13 + Playwright 1.62.1 cannot install `chrome-headless-shell`; local runs
  require pointing `executablePath` at the cached `Chromium.app` (a local-only,
  never-committed config tweak).
