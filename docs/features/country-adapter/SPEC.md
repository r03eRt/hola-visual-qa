# Feature SPEC — country-adapter (#43)

Ticket: #43 · Branch: `feature/country-adapter` · Roadmap: Environment coverage (item 20)
Canonical: `docs/specs/SPEC-007-COUNTRY-ADAPTER.md`

## Goal
A deterministic, dependency-injected adapter that forces the `country` scenario
dimension (`Scenario.country`) into a known state **before navigation** using an
**explicit, approved staging mechanism**, then **verifies the effective country**
by reading a **platform-provided debug signal** back (never assumed), and
**describes the strategy used** in a report-safe way so results are never
misrepresented as real geo-IP tests. Mirrors the SPEC-002 consent-adapter /
SPEC-006 ad-state-adapter contract shape (`apply`/`verify`/`describeRedacted`,
normalized `state_verification_error`). No browser is launched in unit tests.
Additive; changes no existing module behaviour.

## Context and linked canonical specs
- `docs/specs/SPEC-007-COUNTRY-ADAPTER.md` — "Changing locale, timezone or
  geolocation does not change IP country. Supported strategies must be explicit."
  It lists: (1) internal staging header, (2) internal staging cookie/query hook,
  (3) approved proxy endpoint, (4) no override, scenario marked as local country.
  "The adapter applies and verifies the effective country through a
  platform-provided debug signal. Production-only bypasses are prohibited.
  Reports state the strategy used so results are not misrepresented as real
  geo-IP tests."
- Pattern mirror: `src/ads/adapter.ts` + `src/ads/init-script-adapter.ts` and
  `src/consent/adapter.ts` + `src/consent/cookie-adapter.ts` (apply/verify/
  describeRedacted, normalized `state_verification_error`/`state_verification`).
- Dimension source: `Scenario.country` (`src/domain/result.ts`), expanded by
  `src/scenarios/planner.ts` from `config.dimensions.country`.

## Scope
Strategies implemented **in this PR**: `header`, `cookie`, `none`.

Deferred (SPEC-007 lists them, but they are context-external — a `query` param is
a URL-building concern and an approved `proxy` is a launch/infra concern — so
they are **kept OUT of the config enum** to avoid claiming an unimplemented
strategy, per AGENTS.md "Do not claim a feature is implemented because its
specification exists"): `query`-param hook and `proxy` endpoint. Later tickets.

## Non-goals
- Real geo-IP verification or any assertion that the override reflects a real IP.
- Production-only bypasses (explicitly prohibited by SPEC-007).
- `query`-param and `proxy` strategies (deferred; not in the enum).
- Locale/timezone/geolocation emulation — SPEC-007 is explicit that these do NOT
  change country; this adapter does not touch them.
- Wiring the adapter into `tests/visual/*` or `src/orchestrator/run-plan.ts`
  (a later wiring feature does that, as consent was wired in #29). Additive and
  hermetic only.

## Proposed interfaces and files
New files (only these) under `src/country/`:

- `src/country/adapter.ts` — the contract + DI structural interfaces + types:
  ```ts
  export type CountryCode = Scenario['country']; // non-empty string, e.g. 'ES'
  export type CountryStrategy = 'header' | 'cookie' | 'none';

  export interface CountryContextLike {
    setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
    addCookies(
      cookies: ReadonlyArray<{
        name: string; value: string; domain: string; path: string;
        secure: boolean; sameSite: 'Lax' | 'Strict' | 'None';
      }>
    ): Promise<void>;
  }
  export interface CountryVerifyPageLike {
    evaluate<R>(fn: (signal: string) => R, arg: string): Promise<R>;
  }
  export interface CountryVerification {
    satisfied: boolean;              // effective (case-insensitive) === expected
    present: boolean;                // debug signal returned a non-empty string
    effective: string | null;       // the country the debug signal reports
    expectedCountry: CountryCode;
    strategy: CountryStrategy;
  }
  export interface RedactedCountryDescriptor {
    strategy: CountryStrategy;
    expectedCountry: CountryCode;
    mechanism: string;               // 'header <name>' | 'cookie <name>' | 'none'
  }
  export interface CountryAdapter {
    apply(context: CountryContextLike): Promise<void>;
    verify(page: CountryVerifyPageLike): Promise<CountryVerification>;
    describeRedacted(): RedactedCountryDescriptor;
  }
  ```
- `src/country/strategy-adapter.ts` — `StrategyCountryAdapter` implementing the
  contract, the `createCountryAdapter(scenario, config)` factory, the normalized
  `CountryVerificationError` and `assertCountrySatisfied(verification, descriptor)`.
- `src/country/index.ts` — barrel (`export *`).
- `tests/unit/country-adapter.spec.ts` — hermetic tests (hand-written fake
  context/page; no real browser).
- `src/config/schema.ts` — replace the empty `CountryAdapterConfigSchema` with an
  optional/defaulted one (see below). Keep `.strict()` + `.prefault({})` so every
  existing config stays valid and an empty `adapters.country` still validates.
- `docs/STATUS.md` — one honest row (flip "Country override" to `partial`).

## Config schema
```ts
const CountryAdapterConfigSchema = z
  .object({
    strategy: z.enum(['header', 'cookie', 'none']).default('none'),
    headerName: z.string().min(1).optional(),   // default 'X-QA-Country'
    cookieName: z.string().min(1).optional(),   // default 'qa_country'
    cookieDomain: z.string().min(1).optional(), // default: host of config.baseUrl
    debugSignal: z.string().min(1).optional()   // default '__QA_COUNTRY__'
  })
  .strict()
  .prefault({});
```

## Behaviour
- `apply(context)` — before any navigation:
  - `header`: `setExtraHTTPHeaders({ [headerName]: country })`.
  - `cookie`: `addCookies([{ name: cookieName, value: country, domain: cookieDomain,
    path: '/', secure: true, sameSite: 'Lax' }])` (exactly one cookie, mirroring the
    consent cookie adapter's shape).
  - `none`: no-op (installs nothing; the scenario runs at its local country).
- `verify(page)` — reads the platform debug signal (`window[debugSignal]`) back via
  `evaluate`. `effective = (typeof value === 'string' && value.length > 0) ? value : null`;
  `present = effective !== null`; `satisfied = present && effective.toLowerCase() ===
  expectedCountry.toLowerCase()`. Never throws. Applies to `none` too (verifies the
  local country actually matches the scenario's declared country).
- `describeRedacted()` — `{ strategy, expectedCountry, mechanism }` where `mechanism`
  is `` `header ${headerName}` `` / `` `cookie ${cookieName}` `` / `'none'`. Report-safe:
  only a mechanism name, a strategy label and a country code (none are secrets).
- `createCountryAdapter(scenario, config)` — resolves `strategy` from
  `config.adapters.country.strategy`; `headerName`/`cookieName`/`debugSignal` from
  config with the documented defaults; `cookieDomain` from
  `config.adapters.country.cookieDomain` else the host of `config.baseUrl`; country
  from `scenario.country`.
- `assertCountrySatisfied(verification, descriptor)` — throws a normalized
  `state_verification_error` (phase `state_verification`) `CountryVerificationError`
  naming the strategy and expected country (no raw page data) when not satisfied;
  returns silently when satisfied. `verify()` itself never throws; callers decide
  whether to assert.

## Acceptance criteria
- [ ] `apply` for `header` sets exactly the extra header `{ [headerName]: country }`
      and adds no cookie.
- [ ] `apply` for `cookie` adds exactly one cookie `{ name: cookieName, value:
      country, domain, path:'/', secure:true, sameSite:'Lax' }` and sets no header.
- [ ] `apply` for `none` performs no I/O (neither header nor cookie).
- [ ] `verify` reports `satisfied:true, present:true, effective:<code>` when the
      debug signal returns the expected code (case-insensitively); `satisfied:false`
      on a code mismatch; and `present:false, satisfied:false, effective:null` when
      the signal is `undefined`/empty/non-string.
- [ ] `verify` never throws; `assertCountrySatisfied` throws a normalized
      `state_verification_error`/`state_verification` error only when not satisfied,
      and the message names the strategy + expected country and contains no raw page
      data.
- [ ] `createCountryAdapter` uses config-provided `strategy`/`headerName`/
      `cookieName`/`debugSignal` when set and the documented defaults otherwise;
      `cookieDomain` falls back to the host of `config.baseUrl`; country comes from
      `scenario.country`.
- [ ] `describeRedacted()` returns the report-safe descriptor with the correct
      `mechanism` per strategy.
- [ ] Config: an empty `adapters.country` still validates (defaults applied), an
      unknown key under `adapters.country` still fails (`.strict`), and an invalid
      `strategy` value fails.

## Test plan
`tests/unit/country-adapter.spec.ts` (hermetic, no browser):
- A fake `CountryContextLike` records `setExtraHTTPHeaders`/`addCookies` calls;
  assert per-strategy that exactly the right one is called with the right shape and
  the other is not called (incl. `none` calling neither).
- A fake `CountryVerifyPageLike` returns a scripted value; cover exact match,
  case-insensitive match (e.g. `'es'` vs `'ES'`), code mismatch, and
  `undefined`/empty-string/non-string → `present:false, effective:null`.
- Assert `assertCountrySatisfied` throws with the normalized category/phase and a
  message containing the strategy and expected country; and does not throw when
  satisfied.
- Factory: default vs config-provided `strategy`/`headerName`/`cookieName`/
  `debugSignal`, `cookieDomain` fallback to `baseUrl` host, and country routing from
  `scenario.country`.
- `describeRedacted()` per strategy (`mechanism` shape).
- Config-schema assertions: empty `adapters.country` ok; unknown key rejected;
  invalid `strategy` rejected.
- A privacy assertion: a distinctive value never leaks — since country codes are
  intentionally reported, assert instead that no auth/cookie header or secret-like
  token is ever produced by `apply`/`describeRedacted` (only the country code,
  mechanism name and strategy appear).

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- No real browser; do NOT run the visual suite.

## Security/privacy impact
Only a country code, a header/cookie name, a strategy label and a debug-signal key
are handled — none are secrets, auth, credentials or URLs. `describeRedacted()` and
the error message expose only the strategy, expected country and mechanism name.
Nothing is written to disk. Production-only bypasses are NOT implemented (prohibited
by SPEC-007); the debug signal is a QA/staging mechanism only.

## Baseline impact
None. No screenshots are taken or compared; no baselines change.

## Dependencies and risks
- Depends only on existing `src/domain` (Scenario), `src/config` types and
  `src/domain/error.ts` (`normalizeError`).
- Risk: the real staging environment must honour the chosen header/cookie and
  expose the debug signal; that end-to-end contract is validated when a later
  wiring feature integrates the adapter against a live QA target — out of scope
  here.

## Handover notes
Additive module under `src/country/`. Wiring into the run plan / visual suite and
the `query`/`proxy` strategies are separate later tickets. The report must always
state the strategy used (`describeRedacted().strategy`) so a `none`/`header`/
`cookie` run is never presented as a real geo-IP test.
