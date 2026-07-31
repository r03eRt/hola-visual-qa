# Feature: consent-cookie-adapter

Roadmap item #7 (Browser MVP). Tracking issue: #15.

## Goal

A **cookie-strategy** consent adapter implementing the SPEC-002 contract
(`apply(context)`, `verify(page)`, `describeRedacted()`): set the consent
cookie **before navigation**, verify the **effective** state by reading the
cookie back (never assumed), and expose a report-safe descriptor with the raw
consent value **redacted**. Deterministic, config-driven, and testable without
launching a real browser (dependency-injected structural interfaces, like the
browser factory in #6).

## Context and canonical references

- `docs/specs/SPEC-002-CONSENT-ENGINE.md` — the contract (`apply`/`verify`/
  `describeRedacted`), states (`accepted`, `rejected` minimum) and acceptance
  criteria: effective state is VERIFIED not assumed; cookie domain/secure flags
  work for configured hosts; raw consent strings are REDACTED in logs.
- `src/config/schema.ts` — `AdapterConfiguration.consent` =
  `{ cookieName?: string; cookieDomain?: string }`; `ProjectConfig.baseUrl`.
- `src/domain/result.ts` — `Scenario['consent']` = `'accepted' | 'rejected'`
  (the state to apply). `src/domain/error.ts` — use `normalizeError` with
  `category: 'state_verification_error'` and phase `context_setup` (apply) or
  `state_verification` (verify) for failures.
- `src/consent/consent-manager.ts` — the LEGACY scaffold (`setConsentCookie`
  writes `value = mode`, `secure: true`, `sameSite: 'Lax'`, `path: '/'`). Match
  its cookie shape so the existing visual scaffold stays consistent, but do NOT
  modify or depend on it, and do NOT depend on `src/config/env.ts`.

## Non-goals

- No CMP UI interaction / end-to-end verification (#8), no navigation,
  stabilization, screenshots, ads or country adapters.
- Do NOT modify `src/config/*`, `src/domain/*`, `src/scenarios/*`,
  `src/browser/*`, `src/consent/consent-manager.ts`, `playwright.config.ts`, or
  `tests/visual/*`. ADDITIVE under `src/consent/` (new files only).
- Do NOT make the `tests/unit` suite launch a real browser.

## Proposed interfaces and files (new, under `src/consent/`)

- `src/consent/adapter.ts`
  - `type ConsentState = Scenario['consent']` (`'accepted' | 'rejected'`).
  - `interface ConsentAdapter { apply(context): Promise<void>;
    verify(page): Promise<ConsentVerification>; describeRedacted():
    RedactedConsentDescriptor; }`.
  - `interface ConsentVerification { satisfied: boolean; present: boolean;
    expectedState: ConsentState; }` — NEVER include the raw cookie value.
  - `interface RedactedConsentDescriptor { strategy: 'cookie'; cookieName:
    string; cookieDomain: string; expectedState: ConsentState; cookieValue:
    '[redacted]'; }`.
  - Minimal structural interfaces for DI (real Playwright types satisfy them):
    `ConsentContextLike { addCookies(cookies): Promise<void>;
    cookies(urls?): Promise<ReadonlyArray<{ name: string; value: string;
    domain?: string }>>; }` and `ConsentPageLike { context():
    ConsentContextLike; }`.
- `src/consent/cookie-adapter.ts`
  - `interface CookieConsentAdapterOptions { state: ConsentState; cookieName:
    string; cookieDomain: string; valueForState?: (s: ConsentState) => string;
    }`. Default `valueForState` maps `accepted`→`'accepted'`,
    `rejected`→`'rejected'` (matches the legacy scaffold + visual test).
  - `class CookieConsentAdapter implements ConsentAdapter`:
    - `apply(context)` → `context.addCookies([{ name, value: valueForState(state),
      domain, path: '/', secure: true, sameSite: 'Lax' }])`.
    - `verify(page)` → read `page.context().cookies()`, find the cookie by
      name (+ domain when set), compute `present` and `satisfied`
      (value === expected mapped value). Redact any raw values from anything
      returned/logged.
    - `describeRedacted()` → the descriptor above with `cookieValue:
      '[redacted]'`.
  - `createCookieConsentAdapter(scenario, config): CookieConsentAdapter` —
    resolves `cookieName` from `config.adapters.consent.cookieName` (default
    `'consent_status'`) and `cookieDomain` from
    `config.adapters.consent.cookieDomain` else the host of `config.baseUrl`
    (`new URL(config.baseUrl).hostname`); `state` from `scenario.consent`.
  - Optional `assertConsentSatisfied(verification)` helper that throws a
    normalized `state_verification_error` (phase `state_verification`) when
    `!satisfied`, with a redacted message (name/domain/expected only). Callers
    (later orchestration) decide whether to throw; `verify` itself is
    non-throwing.
- `src/consent/index.ts` — barrel for the new adapter (do NOT re-export the
  legacy `consent-manager.ts`).

## Acceptance criteria

- [ ] `apply(context)` adds exactly one cookie with the resolved name/domain,
      `path:'/'`, `secure:true`, `sameSite:'Lax'`, and the state-mapped value.
- [ ] `verify(page)` reports `satisfied:true`/`present:true` when the read-back
      cookie matches, `satisfied:false` on a value mismatch, and
      `present:false` when the cookie is absent — using the effective cookie,
      not the requested state.
- [ ] `createCookieConsentAdapter` resolves cookie name/domain from config with
      the documented defaults (domain falls back to the `baseUrl` host).
- [ ] `describeRedacted()` and any thrown error contain the cookie name/domain
      and expected state but NEVER the raw cookie value (`'[redacted]'`); the
      value never appears in `ConsentVerification` either.
- [ ] `assertConsentSatisfied` throws a normalized `state_verification_error`
      (phase `state_verification`) with a redacted message when not satisfied.
- [ ] `npm run typecheck` and `npm run lint` exit 0; `npx playwright test
      tests/unit` passes and launches NO browser; `docs/STATUS.md` consent row
      updated honestly (cookie apply/verify/redaction done; UI/CMP still
      pending).

## Test plan

- `tests/unit/consent-cookie-adapter.spec.ts` (Playwright `test` runner, DI, NO
  real browser — mirror `tests/unit/browser.spec.ts`). Use fake
  `ConsentContextLike`/`ConsentPageLike` recording `addCookies` and returning a
  scripted `cookies()` list. Cover EVERY acceptance bullet, including: default
  name/domain resolution and `baseUrl`-host fallback; the exact cookie shape;
  satisfied/mismatch/absent verification; redaction in `describeRedacted()`,
  `ConsentVerification` and the thrown error (assert the raw value string does
  NOT appear anywhere in the descriptor/error message).
- Verify: `npm run typecheck` → 0, `npm run lint` → 0, `npx playwright test
  tests/unit` → all pass (no browser). Do NOT run the visual suite.

## Security/privacy impact

Directly implements SPEC-002 redaction: raw consent cookie values are never
placed in descriptors, verification results, logs or thrown errors. Cookies use
`secure:true` and a scoped domain. No real navigation or credentials here.

## Baseline impact

None. Cookie shape matches the existing scaffold so the future visual suite is
unaffected.

## Dependencies and risks

- Depends on #2 (config) and #3 (domain), merged; consistent with #6's DI style.
- Risk: cookie shape drift vs the legacy scaffold/visual test → apply an
  identical shape and cover it with a test.
- Risk: leaking the raw consent value → redaction asserted by explicit
  "value must not appear" tests.

## Handover notes

Well-scoped for Sonnet 5. Keep the unit suite hermetic via DI (like #6). Write
the redaction ("raw value never appears") and verify (satisfied/mismatch/
absent) tests FIRST (`skills/superpowers/test-driven-development`), commit
frequently, and run `skills/superpowers/verification-before-completion` before
the PR (`Closes #15`). Escalate to Opus if the cookie value mapping needs to be
config-driven (would touch the config schema) or if verify must diverge from a
pure cookie read-back.
