# Feature SPEC — placement-render-events (#39)

Ticket: #39 · Branch: `feature/placement-render-events` · Roadmap: Advertising (item 18)
Canonical: `docs/ads/PLACEMENT_MODEL.md`, `docs/specs/SPEC-006-AD-PLACEMENTS.md`

## Goal
Observe a placement's **render/completion stage** through APPROVED application
lifecycle-event signals and classify it into exactly one of
`rendered | empty | provider_error | timeout` — the `renderOutcome` that
`classifyPlacement` consumes. This REUSES the generic `PlacementEventsCollector`
from #17 UNCHANGED and adds only a PURE `evaluateRender` evaluator. This is the
step that lets the tool separate "empty response" from "rendering failure" from
"timeout", which are visually similar but operationally different (the whole
point of `docs/ads/PLACEMENT_MODEL.md`). No real browser in unit tests.
Additive; changes no existing module.

## Context and linked canonical specs
- `docs/ads/PLACEMENT_MODEL.md` — render is the final stage:
  `requested -> rendered | empty | provider_error | timeout`. The definition
  declares `events.render` (the approved render debug-event NAME).
- `docs/specs/SPEC-006-AD-PLACEMENTS.md` — "Render/completion event is observed
  ... Use stable application test hooks or emitted events rather than
  reverse-engineering vendor internals. The tool must not assert revenue or fill
  solely from DOM appearance." We classify only the approved lifecycle SIGNAL —
  never a DOM heuristic, URL, header, body or vendor payload.
- REUSE (do NOT modify): `src/placements/events.ts` (`PlacementEventsCollector`,
  `countMatching`), `src/placements/model.ts` (`PlacementDefinition`),
  `src/placements/state-machine.ts` (`PlacementSignals`, `classifyPlacement`).
- MIRROR the shape/discipline of `src/placements/request.ts` (#17):
  `evaluate*` + `to*Signals`, `undefined` when not observable.

## Render-signal naming convention (contract decision)
The generic collector stores only `{ placementId, signal }`, so the render
OUTCOME must be encoded in the `signal` name. This feature fixes the convention:
the four approved render outcomes are emitted as signals **namespaced under the
configured base** `definition.events.render`, formatted as
**`` `${base}:${outcome}` ``** where `outcome ∈
{ 'rendered', 'empty', 'provider_error', 'timeout' }`. Rationale: one configured
base name (as the model prescribes) cleanly yields all four mutually-exclusive
outcomes and is distinct from the request signal, without changing the merged
#17 event shape. A helper `renderOutcomeSignal(base, outcome)` is exported so the
later event-bridge wiring emits exactly these names.

## Non-goals
- Layout-shift measurement (item 19), overlap/`protectedRegions`, container
  (item 16) or request (item 17) evaluation.
- ANY change to `src/placements/events.ts` (the #17 collector is reused as-is).
- Raw network capture / vendor reverse-engineering; any DOM-appearance-based
  render inference; any fill/revenue claim.
- Wiring into the scenario planner / orchestrator / visual suite, or exposing
  the event-bridge implementation (later ticket). Contract + pure logic only.
- Timeouts/waiting: `evaluateRender` is a single-shot read of what the collector
  has accumulated at call time; it does NOT itself wait or consult
  `definition.timeoutMs`. (A `timeout` OUTCOME is only reported when the app
  EMITS the approved timeout signal — this feature never fabricates one.)

## Proposed interfaces and files
New file `src/placements/render.ts`:
```ts
export type RenderOutcome = 'rendered' | 'empty' | 'provider_error' | 'timeout';

/** Approved outcome tokens in SEVERITY precedence order (most severe first). */
export const RENDER_OUTCOMES: readonly RenderOutcome[] =
  ['provider_error', 'timeout', 'empty', 'rendered'];

/** The approved emitted signal name for a render outcome under a base name. */
export function renderOutcomeSignal(base: string, outcome: RenderOutcome): string; // `${base}:${outcome}`

export interface RenderObservation {
  placementId: string;
  renderSignal: string | null;                 // definition.events?.render ?? null (the base)
  renderOutcome: RenderOutcome | undefined;     // undefined when renderSignal === null OR no outcome observed
  counts: Record<RenderOutcome, number>;        // per-outcome observed counts (diagnosis; 0s when not observable)
}

export function evaluateRender(
  definition: PlacementDefinition, collector: PlacementEventsCollector
): RenderObservation;

export function toRenderSignals(observation: RenderObservation): Pick<PlacementSignals, 'renderOutcome'>;
```
`evaluateRender` rules:
- `base = definition.events?.render ?? null`.
- If `base === null` → `{ placementId: definition.id, renderSignal: null,
  renderOutcome: undefined, counts: { rendered:0, empty:0, provider_error:0,
  timeout:0 } }` (render stage NOT observable — leave `undefined` so
  `classifyPlacement` stays at the non-terminal `requested` boundary rather than
  fabricating a `timeout`/failure).
- Else compute `counts[outcome] = collector.countMatching(definition.id,
  renderOutcomeSignal(base, outcome))` for every outcome. `renderOutcome` =
  the FIRST outcome in `RENDER_OUTCOMES` (severity order:
  `provider_error > timeout > empty > rendered`) whose count `> 0`, or
  `undefined` when all counts are `0` (observed nothing yet → still `requested`).

`toRenderSignals` returns `{ renderOutcome: observation.renderOutcome }` for
feeding `classifyPlacement` (alongside the #16 container and #17 request signals).

Update `src/placements/index.ts` barrel: add `export * from './render.js';`.

## Behaviour with the state machine (assert against the REAL classifyPlacement)
Given container-ready + request-observed signals plus `toRenderSignals`:
- outcome `rendered` → state `rendered`; `empty` → `empty`;
  `provider_error` → `provider_error`; `timeout` → `timeout` (all terminal).
- `renderOutcome: undefined` (base null OR nothing observed) → `requested`
  (non-terminal).
- Severity precedence: when e.g. both `provider_error` and `rendered` signals
  are present for the placement, `evaluateRender` reports `provider_error`
  (documented QA-safe choice — a failure is never masked by a later success).

## Acceptance criteria
- [ ] `renderOutcomeSignal(base, outcome)` returns exactly `` `${base}:${outcome}` ``
      for each outcome.
- [ ] `evaluateRender` with `events.render` configured returns the correct single
      outcome for each of the four outcomes; returns `undefined` with all-zero
      `counts` when the base is configured but no outcome signal was observed;
      and returns `undefined`, `renderSignal:null`, all-zero `counts` when no
      `events`/`events.render` is configured.
- [ ] Severity precedence: with multiple outcome signals present, the
      most-severe (`provider_error > timeout > empty > rendered`) is reported,
      while `counts` still reflects every observed outcome.
- [ ] `counts` reflects `collector.countMatching` per outcome (duplicates
      counted; only exact `id` + namespaced-signal matches counted — a different
      placement id or a bare/request signal does not count).
- [ ] Feeding `toRenderSignals` (with container-ready + request-observed) into
      the REAL `classifyPlacement` yields `rendered`/`empty`/`provider_error`/
      `timeout` for each outcome and `requested` when `renderOutcome` is
      `undefined`. Also assert `isPlacementSatisfied` agrees (`rendered`→true,
      `empty`→`expectedEmpty`, `provider_error`/`timeout`→false).
- [ ] No `RenderObservation` field carries a URL/header/body/payload — only ids,
      signal names, an outcome/undefined and integer counts.

## Test plan
`tests/unit/placement-render-events.spec.ts` (hermetic, no browser):
- Reuse the REAL `createPlacementEventsCollector` from #17 with a fake
  `PlacementEventSourceLike`, emit namespaced render signals, and assert
  `evaluateRender` for: each single outcome; precedence with multiple; nothing
  observed (undefined + zero counts); base not configured (undefined + null
  signal). Include a negative: a bare `base` signal (no `:outcome`) and a
  different placement id do NOT count.
- `renderOutcomeSignal` format for all four outcomes; `RENDER_OUTCOMES` order.
- Integration-in-unit against the REAL `classifyPlacement` and
  `isPlacementSatisfied` for every outcome + the `requested` boundary
  (incl. `expectedEmpty` on/off for `empty`).
- `toRenderSignals` shape and a privacy assertion (no URL/payload string in the
  observation).

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`. No browser; do NOT
  run the visual suite.

## Security/privacy impact
Reuses the #17 collector, which stores only `{ placementId, signal }`. The
render observation adds only ids, signal names, an outcome enum/undefined and
integer counts — no URL/header/body/payload. Nothing is written to disk.

## Baseline impact
None. No screenshots taken or compared.

## Dependencies and risks
- Depends on `src/placements/*` (#33 + #17) only; does not modify them.
- Risk: the real event bridge must emit the namespaced `` `${base}:${outcome}` ``
  signals — documented here and exported via `renderOutcomeSignal` so wiring is
  unambiguous. `undefined`-when-unobserved avoids fabricating a failure/timeout.

## Handover notes
Additive module `src/placements/render.ts`. With #16/#17/#18 the three
`classifyPlacement` stage-signal producers exist; item 19 (layout shift) and the
orchestrator/config wiring that assembles per-scenario `PlacementSignals` and
runs the checks are separate later tickets.
