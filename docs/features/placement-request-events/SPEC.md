# Feature SPEC — placement-request-events (#37)

Ticket: #37 · Branch: `feature/placement-request-events` · Roadmap: Advertising (item 17)
Canonical: `docs/ads/PLACEMENT_MODEL.md`, `docs/specs/SPEC-006-AD-PLACEMENTS.md`

## Goal
Observe a placement's **request stage** through an APPROVED application
lifecycle-event signal (not reverse-engineered vendor network internals) and
produce the `requestObserved` signal `classifyPlacement` consumes. Split into a
**generic, dependency-injected `PlacementEventsCollector`** (subscribes to an
approved event source at construction, accumulates a secret-free snapshot of
`{ placementId, signal }` events) and a **pure `evaluateRequest`** (maps the
snapshot + `definition.events.request` into a `RequestObservation`). The
collector is deliberately GENERIC so item 18 (render events) reuses it unchanged.
No real browser in unit tests. Additive; changes no existing module.

## Context and linked canonical specs
- `docs/ads/PLACEMENT_MODEL.md` — request is one stage of the state machine
  (`container_ready -> request_missing | requested`); the definition declares
  `events.request` (the approved debug-event NAME). This feature only observes
  that signal — it does NOT observe render (item 18) or touch container (item 16).
- `docs/specs/SPEC-006-AD-PLACEMENTS.md` — "Request event is observed through an
  approved integration signal ... Use stable application test hooks or emitted
  events rather than reverse-engineering vendor internals." The collector stores
  ONLY the app-emitted `{ placementId, signal }` — never a URL, header, body or
  vendor payload — so it makes no revenue/fill claim.
- Reuse `src/placements/model.ts` (`PlacementDefinition`) and
  `src/placements/state-machine.ts` (`PlacementSignals`, `classifyPlacement`)
  from #33 — do NOT redefine them.
- Pattern to MIRROR: `src/diagnostics/collector.ts` — subscribe-at-construction,
  accumulate in insertion order, `snapshot()` returns a deep copy isolated from
  later mutation. Also `src/diagnostics/page-events.ts` for the DI `on(...)`
  event-source interface style (a real Playwright/bridge object satisfies it).

## Non-goals
- Render/completion evaluation (item 18) — though the collector it adds is the
  shared substrate item 18 will reuse.
- Layout-shift (item 19), overlap/`protectedRegions`, container checks (item 16).
- Raw network capture or any vendor reverse-engineering.
- Any assertion about ad fill or revenue.
- Wiring into the scenario planner / orchestrator / visual suite, or exposing
  the event bridge implementation (the real source backing
  `PlacementEventSourceLike` — a page binding / documented event bridge — is a
  later wiring ticket). This feature defines the contract + pure logic only.
- Timeouts/waiting: evaluation is a single-shot read of what was accumulated up
  to the call (the collector accumulates live; the caller decides WHEN to
  evaluate, e.g. after readiness). `definition.timeoutMs` is not consulted here.

## Proposed interfaces and files
New file `src/placements/events.ts` (the generic collector, reused by #18):
```ts
/** An already-normalized, approved lifecycle event. NO url/header/body/payload. */
export interface PlacementLifecycleEvent { placementId: string; signal: string; }

/** DI event source; a real page binding / documented event bridge satisfies this. */
export interface PlacementEventSourceLike {
  on(event: 'placement', handler: (e: PlacementLifecycleEvent) => void): void;
}

export interface PlacementEventsSnapshot { events: PlacementLifecycleEvent[]; }

export interface PlacementEventsCollector {
  snapshot(): PlacementEventsSnapshot;         // deep copy, insertion order
  countMatching(placementId: string, signal: string): number;
}

export function createPlacementEventsCollector(source: PlacementEventSourceLike): PlacementEventsCollector;
```
Behaviour:
- On construction, registers ONE `on('placement', ...)` handler. Each received
  event is normalized to EXACTLY `{ placementId, signal }` (extra fields on the
  incoming object are dropped — defensive, keeps secrets/payloads out) and
  pushed in insertion order.
- `snapshot()` returns a deep copy (new array + new objects) isolated from later
  mutation on either side.
- `countMatching(placementId, signal)` returns the number of accumulated events
  whose `placementId` AND `signal` match exactly (case-sensitive).

New file `src/placements/request.ts` (the request evaluator):
```ts
export interface RequestObservation {
  placementId: string;
  requestSignal: string | null;          // definition.events?.request ?? null
  requestObserved: boolean | undefined;  // undefined when requestSignal === null (not observable)
  count: number;                         // matched events (0 when not observable)
}
export function evaluateRequest(
  definition: PlacementDefinition, collector: PlacementEventsCollector
): RequestObservation;
export function toRequestSignals(observation: RequestObservation): Pick<PlacementSignals, 'requestObserved'>;
```
`evaluateRequest` rules:
- `requestSignal = definition.events?.request ?? null`.
- If `requestSignal === null` → `{ placementId: definition.id, requestSignal: null,
  requestObserved: undefined, count: 0 }` (no approved request signal is
  configured, so the request stage is NOT observable — honestly leave it
  `undefined` so `classifyPlacement` stays at the non-terminal `container_ready`
  boundary rather than falsely reporting `request_missing`).
- Else `count = collector.countMatching(definition.id, requestSignal)`;
  `requestObserved = count > 0`.

`toRequestSignals` returns `{ requestObserved: observation.requestObserved }` for
feeding `classifyPlacement` (alongside the container-stage signals from #16).

Update `src/placements/index.ts` barrel: `export * from './events.js';` and
`export * from './request.js';`.

## Acceptance criteria
- [ ] `createPlacementEventsCollector` registers exactly one `on('placement')`
      handler on construction; events arriving afterwards are accumulated in
      insertion order; `snapshot()` is a deep copy isolated from later mutation
      (mutating the returned array/objects does not change the collector and
      vice-versa).
- [ ] Incoming events with EXTRA fields (e.g. a `url`/`payload`) are normalized
      to only `{ placementId, signal }` — the extra field never appears in the
      snapshot (asserted directly, guarding against payload/secret leakage).
- [ ] `countMatching` counts only exact `placementId` + `signal` matches
      (different id or different signal do not count; duplicates count).
- [ ] `evaluateRequest`: with `events.request` configured and >=1 matching event
      → `requestObserved:true`, `count>=1`; configured and 0 matching →
      `requestObserved:false`, `count:0`; with NO `events`/`events.request` →
      `requestObserved:undefined`, `count:0`, `requestSignal:null`.
- [ ] Feeding `toRequestSignals` (with the #16 container signals) into
      `classifyPlacement` yields: container ready + request observed →
      `requested`; container ready + request configured-but-missing →
      `request_missing`; container ready + request NOT observable (undefined) →
      `container_ready` (non-terminal). (Assert against the REAL `classifyPlacement`.)
- [ ] No snapshot/observation field carries a URL, header, body or payload —
      only ids, signal names, a boolean/undefined and a count.

## Test plan
`tests/unit/placement-request-events.spec.ts` (hermetic, no browser):
- Fake `PlacementEventSourceLike` that records the registered handler and lets
  the test emit synthetic events; assert single registration, insertion-order
  accumulation, deep-copy isolation, and extra-field stripping.
- `countMatching` matrix: matching, wrong id, wrong signal, duplicates.
- `evaluateRequest` three cases (observed / configured-missing / not-observable)
  and the `toRequestSignals` shape.
- Integration-in-unit: combine with a container observation's signals and pass
  to the REAL `classifyPlacement` for the three states above.

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`. No browser; do NOT
  run the visual suite.

## Security/privacy impact
The collector deliberately stores ONLY `{ placementId, signal }` and drops every
other field on the incoming event, so no URL/header/body/vendor payload can enter
a snapshot or observation. Nothing is written to disk.

## Baseline impact
None. No screenshots taken or compared.

## Dependencies and risks
- Depends on `src/placements/*` (#33) only.
- Risk: the real approved event bridge backing `PlacementEventSourceLike` must
  emit `{ placementId, signal }`; that integration is a later wiring ticket —
  out of scope. The `undefined` (not-observable) semantics avoid false
  `request_missing` verdicts when no signal is configured.

## Handover notes
Additive modules `src/placements/events.ts` (generic, reused by #18) and
`src/placements/request.ts`. Item 18 adds `evaluateRender` over the SAME
collector; item 19 (layout shift) and orchestrator/config wiring are later.
