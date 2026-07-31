# Feature: consent-state-verification

Roadmap item #8 (Browser MVP). Tracking issue: #17.

## Goal

Deliver the two SPEC-002 acceptance criteria that #7 deferred:

1. **Resilient CMP UI interaction** — accept/reject the consent banner using
   role/test-id selectors (never brittle CSS, never arbitrary long sleeps), and
   don't fail when the banner is absent (cookie pre-seeding may have suppressed
   it).
2. **Effective-state verification** — confirm the consent state is really in
   effect by combining multiple signals (the #7 cookie read-back **and** the
   CMP banner being dismissed), reported in one **redacted** result, with an
   assert that throws a normalized `state_verification_error`.

Deterministic and testable WITHOUT launching a real browser (dependency-
injected structural interfaces, exactly like #6 and #7).

## Context and canonical references

- `docs/specs/SPEC-002-CONSENT-ENGINE.md` — "The effective state is verified,
  not assumed", "UI fallback uses resilient role/test-id selectors", "Raw
  consent strings are redacted in logs".
- `src/consent/adapter.ts` (#7) — `ConsentAdapter`, `ConsentState`,
  `ConsentVerification`, `ConsentPageLike` (has `context()`). REUSE these; do
  NOT modify them.
- `src/consent/cookie-adapter.ts` (#7) — `CookieConsentAdapter` provides the
  cookie signal via `verify(page)`. REUSE; do NOT modify.
- `src/consent/consent-manager.ts` — legacy `setConsentThroughUi(page, mode)`
  (role-button regex `/accept|aceptar/i` vs `/reject|rechazar/i`). Model the
  resilient version on this, but do NOT modify or import it, and do NOT depend
  on `src/config/env.ts`.
- `src/domain/error.ts` — `normalizeError` with `category:
  'state_verification_error'`, phase `state_verification`.

## Non-goals

- No navigation, page stabilization, screenshots, ads/country adapters, or
  orchestration.
- Do NOT modify `src/config/*`, `src/domain/*`, `src/scenarios/*`,
  `src/browser/*`, `src/consent/adapter.ts`, `src/consent/cookie-adapter.ts`,
  `src/consent/consent-manager.ts`, `playwright.config.ts`, or `tests/visual/*`.
  ADDITIVE: new files under `src/consent/` only.
- Do NOT add CMP selector fields to the config schema (keep selectors as
  options with defaults; a config-driven version is a later additive change).
- Do NOT make the `tests/unit` suite launch a real browser.

## Proposed interfaces and files (new, under `src/consent/`)

- `src/consent/ui-types.ts`
  - `interface ConsentLocatorLike { first(): ConsentLocatorLike; isVisible():
    Promise<boolean>; click(options?: { timeout?: number }): Promise<void>; }`.
  - `interface ConsentUiPageLike { getByRole(role: 'button', options?: { name?:
    string | RegExp }): ConsentLocatorLike; getByTestId(testId: string):
    ConsentLocatorLike; }`. (A real Playwright `Page` satisfies this.)
  - `type ConsentVerifyPageLike = ConsentPageLike & ConsentUiPageLike` (needs
    both `context()` for the cookie signal and the UI locators).
- `src/consent/ui.ts`
  - `interface ConsentUiSelectors { acceptName: RegExp; rejectName: RegExp;
    bannerTestId?: string; }` and `DEFAULT_CONSENT_UI_SELECTORS`
    (`acceptName: /accept|aceptar/i`, `rejectName: /reject|rechazar/i`).
    Resilient by construction (role + accessible name, optional test-id banner).
  - `applyConsentThroughUi(page: ConsentUiPageLike, state: ConsentState,
    selectors?): Promise<ConsentUiOutcome>` — clicks the accept or reject button
    (by role+name) when it is visible; returns `{ interacted: boolean }`. NEVER
    throws when the banner/button is absent (returns `interacted:false`). Uses
    bounded visibility checks, NOT arbitrary sleeps.
  - `isConsentBannerVisible(page, selectors?): Promise<boolean>` — true when the
    banner (by test-id if configured, else the accept/reject button) is visible.
- `src/consent/state-verifier.ts`
  - `interface ConsentStateReport { expectedState: ConsentState; satisfied:
    boolean; signals: { cookie: ConsentVerification; bannerDismissed: boolean };
    }` — NEVER includes the raw cookie value.
  - `verifyConsentState(page: ConsentVerifyPageLike, adapter: ConsentAdapter,
    options?: { selectors?: ConsentUiSelectors }): Promise<ConsentStateReport>`
    — runs `adapter.verify(page)` (cookie signal) and computes
    `bannerDismissed = !isConsentBannerVisible(page, selectors)`; `satisfied =
    cookie.satisfied && bannerDismissed`. Reports both signals so a failure
    shows WHICH one failed.
  - `assertConsentState(report: ConsentStateReport, descriptor: { cookieName:
    string; cookieDomain: string }): void` — throws a normalized
    `state_verification_error` (phase `state_verification`) with a REDACTED
    message (name/domain/expected state + which signal failed) when
    `!report.satisfied`. Never throws when satisfied.
- `src/consent/index.ts` — extend the barrel with the new modules.

## Acceptance criteria

- [ ] `applyConsentThroughUi` clicks the ACCEPT button for `accepted` and the
      REJECT button for `rejected` (matched by role + accessible name) when
      visible, returns `interacted:true`, and does NOT throw / returns
      `interacted:false` when the button is absent.
- [ ] UI selectors are role/test-id based (no CSS), overridable, with the
      documented Spanish/English defaults; no arbitrary `waitForTimeout`.
- [ ] `isConsentBannerVisible` reflects banner presence via test-id (when set)
      or the accept/reject button visibility.
- [ ] `verifyConsentState` combines the cookie signal (via `adapter.verify`)
      and `bannerDismissed`, and `satisfied` is true only when BOTH hold; the
      report exposes both signals for diagnosis.
- [ ] `assertConsentState` throws a normalized `state_verification_error`
      (phase `state_verification`) with a redacted message identifying the
      failing signal; the raw cookie value never appears in the report or error.
- [ ] `npm run typecheck` and `npm run lint` exit 0; `npm run test:unit` passes
      and launches NO browser; `docs/STATUS.md` consent row updated honestly
      (UI interaction + effective-state verification now exist).

## Test plan

- `tests/unit/consent-state-verification.spec.ts` (Playwright `test` runner, DI,
  NO real browser — mirror `tests/unit/consent-cookie-adapter.spec.ts`). Provide
  fake `ConsentLocatorLike` (scriptable `isVisible`, recording `click`) and a
  fake `ConsentVerifyPageLike` composing a cookie-returning `context()` with
  `getByRole`/`getByTestId`. Cover EVERY acceptance bullet: accept vs reject
  click routing; no-throw + `interacted:false` when absent; banner visibility;
  combined satisfied/fail-by-cookie/fail-by-banner in `verifyConsentState`; the
  redacted throw in `assertConsentState` (assert a distinctive raw cookie value
  never appears in `JSON.stringify(report)` or `error.message`).
- Verify: `npm run typecheck` → 0, `npm run lint` → 0, `npm run test:unit` →
  all pass (no browser). Do NOT run the visual suite.

## Security/privacy impact

Extends SPEC-002 redaction to the verifier: neither the combined report, the
banner signal, nor thrown errors contain the raw consent value. UI interaction
uses accessible roles/names — no secrets. No real navigation here.

## Baseline impact

None.

## Dependencies and risks

- Depends on #7 (cookie adapter) and #3 (domain), merged; DI style from #6/#7.
- Risk: brittle selectors → role/test-id only, defaults documented, overridable,
  covered by tests.
- Risk: false "dismissed" when the banner never existed → `bannerDismissed` is
  derived from actual visibility checks; `verifyConsentState` also requires the
  cookie signal, so a missing banner alone cannot mark an unset state satisfied.

## Handover notes

Well-scoped for Sonnet 5; compose with #7, don't modify it. Keep the unit suite
hermetic via DI. Write the redaction and combined-signal tests FIRST
(`skills/superpowers/test-driven-development`), commit frequently, and run
`skills/superpowers/verification-before-completion` before the PR (`Closes
#17`). Escalate to Opus if the UI strategy needs to implement the full
`ConsentAdapter` interface (would require generalizing #7's descriptor) or if
selectors must become config-schema fields.
