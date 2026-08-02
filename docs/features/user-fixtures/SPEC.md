# Feature SPEC — user-fixtures (#45)

Ticket: #45 (`type:feature`, `type:security`) · Branch: `feature/user-fixtures`
Roadmap: Environment coverage (item 21)
Canonical: `docs/specs/SPEC-001-SCENARIO-ENGINE.md` (lists "user fixture" as a
scenario dimension).

## Goal
A deterministic, dependency-injected adapter that puts a scenario into a known
**user state** (`Scenario.userFixture`) **before navigation** — either
`anonymous` (logged-out; no-op) or `storage-state` (apply a fixture's Playwright
storageState) — then **verifies the effective user** by reading a
platform-provided debug signal back (never assumed), and **describes itself in a
report-safe way**. Mirrors the SPEC-002 consent / SPEC-006 ad-state / SPEC-007
country adapter contract shape (`apply`/`verify`/`describeRedacted`, normalized
`state_verification_error`). No browser and **no filesystem** in unit tests.
Additive; changes no existing module behaviour.

## Security-first design (NON-NEGOTIABLE — this is a `type:security` ticket)
- **No credentials, cookies, tokens or auth state are ever committed, embedded in
  the committed config, serialized, logged, or exposed.** The committed config
  references a fixture by `id` and, optionally, a `storageStateRef` — a
  **gitignored** path (e.g. `playwright/.auth/<id>.json`, already matched by
  `.gitignore`'s `playwright/.auth/*.json`). The auth material itself is never
  committed.
- The adapter **never reads the filesystem itself**. Auth state is resolved
  through an injected `StorageStateLoader` DI port; its real fs-backed
  implementation is a later wiring ticket. This keeps the feature 100% hermetic
  and keeps auth I/O out of this module.
- `describeRedacted()` exposes only `{ strategy, expectedUser, hasAuthState }` —
  never cookie/localStorage values, tokens or the ref path.
- Error messages name only the strategy and expected user id — never
  effective-user values, cookie/token values, paths, or any auth material.
- The existing secret-key guard already rejects `storageState`/`storage_state`
  keys on `Scenario`/domain objects; nothing here reintroduces them.

## Context and linked patterns
- Pattern mirror: `src/country/adapter.ts` + `src/country/strategy-adapter.ts`
  and `src/ads/*` / `src/consent/*` (apply/verify/describeRedacted, normalized
  `state_verification_error`/`state_verification`, `configuration_error`/
  `planning` for a misconfigured fixture).
- Dimension source: `Scenario.userFixture` (`src/domain/result.ts`, an optional
  non-empty string; `undefined` = anonymous).
- `.gitignore` already contains `playwright/.auth/*.json`.

## Scope
- Additive `src/user/` module + a new `adapters.user` config section (fixtures
  registry + `debugSignal`).
- Strategies implemented: `storage-state`, `anonymous`.
- Hermetic unit tests only; **no real browser, no fs**.

## Non-goals
- Real login/auth flows or credential capture.
- storageState **generation** (creating the auth JSON) — that is an operator/CI
  step; this feature only *applies* an already-provided, gitignored state.
- The fs-backed `StorageStateLoader` implementation (later wiring ticket).
- Planner dimension expansion, scenario-ID changes, and wiring into
  `tests/visual/*` / `src/orchestrator/*` (kept exactly like consent/ads/country;
  scenario IDs and committed baselines are UNCHANGED).

## Proposed interfaces and files
New files (only these) under `src/user/`:

- `src/user/adapter.ts` — contract + DI structural interfaces + types:
  ```ts
  export type UserFixtureId = NonNullable<Scenario['userFixture']>; // non-empty string
  export type UserFixtureStrategy = 'storage-state' | 'anonymous';

  export interface StorageStateCookie {
    name: string; value: string; domain: string; path: string;
    expires?: number; httpOnly?: boolean; secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
  }
  export interface StorageStateOrigin {
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }
  export interface StorageState {
    cookies: StorageStateCookie[];
    origins: StorageStateOrigin[];
  }

  /** DI port: resolves a fixture's storage state WITHOUT this module doing fs. */
  export interface StorageStateLoader {
    load(ref: string): Promise<StorageState>;
  }

  export interface UserFixtureContextLike {
    addCookies(cookies: ReadonlyArray<StorageStateCookie>): Promise<void>;
    addInitScript(
      script: (arg: { origins: StorageStateOrigin[] }) => void,
      arg: { origins: StorageStateOrigin[] }
    ): Promise<void>;
  }
  export interface UserFixtureVerifyPageLike {
    evaluate<R>(fn: (signal: string) => R, arg: string): Promise<R>;
  }

  export interface UserFixtureVerification {
    satisfied: boolean;
    present: boolean;                 // debug signal returned a non-empty string
    effectiveUser: string | null;     // the user id the signal reports
    expectedUser: UserFixtureId | 'anonymous';
    strategy: UserFixtureStrategy;
  }
  export interface RedactedUserFixtureDescriptor {
    strategy: UserFixtureStrategy;
    expectedUser: UserFixtureId | 'anonymous';
    hasAuthState: boolean;            // true only for 'storage-state'
  }
  export interface UserFixtureAdapter {
    apply(context: UserFixtureContextLike): Promise<void>;
    verify(page: UserFixtureVerifyPageLike): Promise<UserFixtureVerification>;
    describeRedacted(): RedactedUserFixtureDescriptor;
  }
  ```
- `src/user/storage-state-adapter.ts` — `StorageStateUserFixtureAdapter`
  implementing the contract, `createUserFixtureAdapter(scenario, config, loader)`,
  the normalized `UserFixtureVerificationError` (state verification) and
  `UserFixtureConfigError` (configuration), and
  `assertUserFixtureSatisfied(verification, descriptor)`.
- `src/user/index.ts` — barrel (`export *`).
- `tests/unit/user-fixtures.spec.ts` — hermetic tests (fake context/page/loader;
  no real browser, no fs).
- `src/config/schema.ts` — add `UserAdapterConfigSchema` and wire it into
  `AdapterConfigurationSchema` as `user` (see below). Keep every object
  `.strict()`; keep `.prefault({})` so an empty `adapters` / `adapters.user` still
  validates.
- `docs/STATUS.md` — one honest row (add a "User fixtures" capability row as
  `partial`).

## Config schema
```ts
const UserFixtureDefinitionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    // Gitignored reference to a Playwright storageState JSON (a path, not a
    // secret). Absent => a logged-out ('anonymous') named fixture.
    storageStateRef: z.string().min(1).optional()
  })
  .strict();

const UserAdapterConfigSchema = z
  .object({
    debugSignal: z.string().min(1).optional(), // default '__QA_USER__'
    fixtures: z.array(UserFixtureDefinitionSchema).default([])
  })
  .strict()
  .prefault({});
```
Wire `user: UserAdapterConfigSchema` into `AdapterConfigurationSchema` alongside
`consent`/`ads`/`country`. Existing manually-typed `ProjectConfig` fixtures in
other specs must gain `user: { fixtures: [] }` (a direct, unavoidable consequence
of the new required output key — no other logic touched).

## Behaviour
- `createUserFixtureAdapter(scenario, config, loader)`:
  - `scenario.userFixture === undefined` → an `anonymous` adapter with
    `expectedUser: 'anonymous'`, no ref, no loader use.
  - otherwise → look up the fixture by `id` in `config.adapters.user.fixtures`:
    - not found → throw `UserFixtureConfigError` (normalized
      `configuration_error` / `planning`) naming the missing fixture id.
    - found with `storageStateRef` → `storage-state` strategy, `expectedUser =
      def.id`, ref stored (never exposed).
    - found without `storageStateRef` → `anonymous` strategy (a named logged-out
      fixture), `expectedUser = def.id`.
  - `debugSignal` resolves from `config.adapters.user.debugSignal ?? '__QA_USER__'`.
- `apply(context)`:
  - `anonymous`: no-op.
  - `storage-state`: `state = await loader.load(ref)`; `await
    context.addCookies(state.cookies)`; if `state.origins.length > 0`, `await
    context.addInitScript(seed, { origins: state.origins })` where `seed` writes
    each origin's `localStorage` entries only when `window.location.origin`
    matches. Exactly one `addCookies` call and at most one `addInitScript` call.
- `verify(page)`: reads `window[debugSignal]` back via `evaluate`. `effectiveUser
  = (typeof value === 'string' && value.length > 0) ? value : null`; `present =
  effectiveUser !== null`.
  - `storage-state`: `satisfied = present && effectiveUser === expectedUser`
    (exact match — user ids are case-sensitive).
  - `anonymous`: `satisfied = !present` (a logged-out session reports no user).
  - Never throws.
- `describeRedacted()`: `{ strategy, expectedUser, hasAuthState: strategy ===
  'storage-state' }`. Report-safe.
- `assertUserFixtureSatisfied(verification, descriptor)`: throws a normalized
  `state_verification_error` (phase `state_verification`)
  `UserFixtureVerificationError` naming the strategy and expected user (no
  effective-user value, no auth material) when not satisfied; silent when
  satisfied. `verify()` itself never throws.

## Acceptance criteria
- [ ] `apply` for `anonymous` performs no I/O (no `addCookies`, no `addInitScript`,
      no `loader.load`).
- [ ] `apply` for `storage-state` calls `loader.load(ref)` once, `addCookies`
      exactly once with the loaded cookies, and `addInitScript` at most once
      (only when origins are present); running the seed against a fake `window`
      writes localStorage only for the matching origin.
- [ ] `verify` (`storage-state`) reports `satisfied:true` on an exact user match,
      `satisfied:false` on mismatch, and `present:false, effectiveUser:null` on an
      absent/empty/non-string signal.
- [ ] `verify` (`anonymous`) reports `satisfied:true` when the signal is
      absent/empty and `satisfied:false` when a user id is present.
- [ ] `verify` never throws; `assertUserFixtureSatisfied` throws a normalized
      `state_verification_error`/`state_verification` error only when not
      satisfied, naming strategy + expected user and containing no auth material.
- [ ] `createUserFixtureAdapter` resolves anonymous for `undefined`
      `scenario.userFixture`, `storage-state` for a fixture with a ref, `anonymous`
      for a fixture without a ref, and throws a normalized
      `configuration_error`/`planning` `UserFixtureConfigError` for an unknown
      fixture id; `debugSignal` default vs config-provided.
- [ ] `describeRedacted()` returns `{ strategy, expectedUser, hasAuthState }` with
      the correct `hasAuthState` per strategy.
- [ ] Config: an empty `adapters.user` still validates (defaults applied), an
      unknown key under `adapters.user` or a fixture entry still fails (`.strict`),
      and a fixture missing `id` fails.
- [ ] **Security**: a test loads a StorageState containing a distinctive cookie
      value and a distinctive localStorage token, runs `apply` + `describeRedacted`,
      and asserts NEITHER distinctive value appears in `JSON.stringify` of the
      descriptor, and that neither appears in any thrown error message; also assert
      the ref path never appears in the descriptor.

## Test plan
`tests/unit/user-fixtures.spec.ts` (hermetic, no browser, no fs):
- Fake `UserFixtureContextLike` recording `addCookies`/`addInitScript` calls; fake
  `UserFixtureVerifyPageLike` returning a scripted value; fake `StorageStateLoader`
  returning a scripted `StorageState` and counting `load` calls.
- Cover every acceptance criterion above, including the seed function's
  origin-matching localStorage write (run the recorded init script against a fake
  `window` with a matching and a non-matching `location.origin`).
- Config-schema assertions (empty ok; unknown key rejected; fixture without `id`
  rejected).
- The security/redaction assertion described in the acceptance criteria.

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- No real browser, no fs; do NOT run the visual suite.

## Security/privacy impact
This is a `type:security` feature. It handles auth storageState **only at
runtime, only through an injected loader**, and never commits, serializes, logs or
exposes any credential, cookie value, token or ref path. `describeRedacted()` and
all error messages are limited to the strategy, the expected user id and a boolean
`hasAuthState`. The committed config holds only fixture ids/labels and a gitignored
ref path. Nothing is written to disk by this module.

## Baseline impact
None. No screenshots are taken or compared; scenario IDs and baselines are
unchanged (no planner/ID change).

## Dependencies and risks
- Depends only on existing `src/domain` (Scenario), `src/config` types and
  `src/domain/error.ts` (`normalizeError`).
- Risk: the real staging app must expose the user debug signal and the operator
  must provide the gitignored storageState files; those end-to-end contracts are
  validated by a later wiring ticket and the fs-backed loader — out of scope here.

## Handover notes
Additive module under `src/user/`. The fs-backed `StorageStateLoader`, planner
dimension expansion + scenario-ID change, and wiring into the run plan / visual
suite are separate later tickets. The report must always state the strategy
(`describeRedacted().strategy`) and only `hasAuthState` — never auth material.
