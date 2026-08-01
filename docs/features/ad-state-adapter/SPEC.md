# Feature SPEC — ad-state-adapter (#31)

Ticket: #31 · Branch: `feature/ad-state-adapter` · Roadmap: Advertising (item 14)
Canonical: `docs/specs/SPEC-006-AD-PLACEMENTS.md`

## Goal
A deterministic, dependency-injected adapter that forces the `ads_on`/`ads_off`
scenario dimension (`Scenario.adsEnabled: boolean`) into a known state **before
navigation**, using an **approved application test hook** (a documented
`window` flag installed via the context init script) rather than
reverse-engineering vendor internals. It then **verifies the effective state**
by reading the hook back (never assumed) and describes itself in a report-safe
way. Mirrors the SPEC-002 consent-adapter contract shape. No browser is launched
in unit tests. Additive; changes no existing module behaviour.

## Context and linked canonical specs
- `docs/specs/SPEC-006-AD-PLACEMENTS.md` — "Use stable application test hooks or
  emitted events rather than reverse-engineering vendor internals. The tool must
  not assert revenue or fill solely from DOM appearance." This adapter only sets
  and verifies the **requested hook state**; it makes NO claim about fill,
  revenue, container presence, request or render — those are later items 15–19.
- Pattern mirror: `src/consent/adapter.ts` + `src/consent/cookie-adapter.ts`
  (apply/verify/describeRedacted, normalized `state_verification_error`).
- Dimension source: `Scenario.adsEnabled` (`src/domain/result.ts`), expanded by
  `src/scenarios/planner.ts`.

## Non-goals
- Placement container/geometry/request/render/layout-shift checks (items 15–19).
- Asserting ad fill or revenue from DOM appearance.
- Wiring the adapter into `tests/visual/*` or `src/orchestrator/run-plan.ts`
  (a later wiring feature does that, as consent was wired in #29). This feature
  is additive and hermetic only.
- Cookie/query-param strategies (only the init-script hook here; the `strategy`
  enum is left open for a future strategy without breaking config).

## Proposed interfaces and files
New files (only these):
- `src/ads/adapter.ts` — the contract + DI structural interfaces + types:
  ```ts
  export type AdState = Scenario['adsEnabled']; // boolean; true = ads enabled
  export interface AdStateContextLike {
    addInitScript(script: (arg: { flagName: string; enabled: boolean }) => void,
                  arg: { flagName: string; enabled: boolean }): Promise<void>;
  }
  export interface AdStateVerifyPageLike {
    evaluate<R>(fn: (flagName: string) => R, arg: string): Promise<R>;
  }
  export interface AdStateVerification {
    satisfied: boolean;   // effective flag === expected enabled
    present: boolean;     // the hook flag was defined (boolean) at all
    expectedEnabled: AdState;
  }
  export interface RedactedAdStateDescriptor {
    strategy: 'init-script';
    flagName: string;
    expectedEnabled: AdState;
  }
  export interface AdStateAdapter {
    apply(context: AdStateContextLike): Promise<void>;
    verify(page: AdStateVerifyPageLike): Promise<AdStateVerification>;
    describeRedacted(): RedactedAdStateDescriptor;
  }
  ```
- `src/ads/init-script-adapter.ts` — `InitScriptAdStateAdapter` implementing the
  contract, the `createAdStateAdapter(scenario, config)` factory, the normalized
  `AdStateVerificationError` and `assertAdStateSatisfied(verification, descriptor)`.
- `src/ads/index.ts` — barrel (`export *`).
- `tests/unit/ad-state-adapter.spec.ts` — hermetic tests (hand-written fake
  context/page; no real browser).
- `src/config/schema.ts` — extend `AdsAdapterConfigSchema` with optional
  `flagName` and a `strategy` enum defaulting to `'init-script'` (fields
  optional/defaulted so every existing config stays valid).
- `docs/STATUS.md` — one honest row.

## Behaviour
- `apply(context)`: installs the documented hook before any page script via
  `addInitScript`, setting `window[flagName] = enabled` (the boolean from
  `scenario.adsEnabled`). Idempotent per context; sets exactly the requested
  boolean.
- `verify(page)`: reads `window[flagName]` back via `evaluate`. `present` is true
  only when the value is a boolean; `satisfied` is true only when it strictly
  equals `expectedEnabled`. Never throws.
- `describeRedacted()`: `{ strategy, flagName, expectedEnabled }` — no secrets
  (all values are a hook name and a boolean); report-safe.
- `createAdStateAdapter(scenario, config)`: resolves `flagName` from
  `config.adapters.ads.flagName` (default `'__ADS_ENABLED__'`) and the state
  from `scenario.adsEnabled`.
- `assertAdStateSatisfied(verification, { flagName })`: throws a normalized
  `state_verification_error` (phase `state_verification`)
  `AdStateVerificationError` naming the hook and expected state (no raw page
  data) when not satisfied; returns silently when satisfied.

## Acceptance criteria
- [ ] `apply` installs exactly one init script that sets the hook to the boolean
      matching `scenario.adsEnabled` for both `true` and `false`.
- [ ] `verify` reports `satisfied:true, present:true` when the page returns the
      expected boolean; `satisfied:false` on a boolean mismatch; and
      `present:false, satisfied:false` when the hook is `undefined`/non-boolean.
- [ ] `verify` never throws; `assertAdStateSatisfied` throws a normalized
      `state_verification_error`/`state_verification` error only when not
      satisfied, and the message names the flag + expected state.
- [ ] `createAdStateAdapter` uses the config `flagName` when set and the
      `'__ADS_ENABLED__'` default otherwise; state comes from `scenario.adsEnabled`.
- [ ] `describeRedacted()` returns the report-safe descriptor.
- [ ] Config: an unknown key under `adapters.ads` still fails (`.strict`), and an
      empty `adapters.ads` still validates (defaults applied).

## Test plan
`tests/unit/ad-state-adapter.spec.ts` (hermetic, no browser):
- A fake `AdStateContextLike` records `(script, arg)` calls; assert one call and
  that running the recorded script against a fake `window` sets the boolean.
- A fake `AdStateVerifyPageLike` returns a scripted value; cover boolean match,
  boolean mismatch, and `undefined`/non-boolean → `present:false`.
- Assert `assertAdStateSatisfied` throws with the normalized category/phase and a
  message containing the flag name and expected state; and does not throw when
  satisfied.
- Factory: default vs config-provided `flagName`, and state routing from
  `scenario.adsEnabled`.
- A small config-schema assertion: empty `adapters.ads` ok; unknown key rejected.

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- No real browser; do NOT run the visual suite.

## Security/privacy impact
The hook name and a boolean are the only data handled — no secrets, cookies,
auth or URLs. `describeRedacted()` and the error message expose only the flag
name and expected boolean. Nothing is written to disk.

## Baseline impact
None. No screenshots are taken or compared; no baselines change.

## Dependencies and risks
- Depends only on existing `src/domain` (Scenario) and `src/config` types.
- Risk: the real application must honour the chosen hook; that end-to-end
  contract is validated when a later wiring feature integrates the adapter
  against a live QA target — out of scope here.

## Handover notes
Additive module under `src/ads/`. Wiring into the run plan / visual suite and the
placement checks (items 15–19) are separate later tickets.
