# Feature SPEC — placement-contract (#33)

Ticket: #33 · Branch: `feature/placement-contract` · Roadmap: Advertising (item 15)
Canonical: `docs/ads/PLACEMENT_MODEL.md`, `docs/specs/SPEC-006-AD-PLACEMENTS.md`

## Goal
Define the **pure, additive domain contract** for ad placements: a validated
`PlacementDefinition` (what a placement IS and what is expected of it) and a
deterministic **placement state machine** that classifies observed signals into
a single, secret-free terminal `PlacementObservation`. This encodes exactly the
state machine in `docs/ads/PLACEMENT_MODEL.md`, which deliberately separates
"no container", "no request", "empty response" and "rendering failure" —
visually similar but operationally different. TYPES + validation + a pure
classifier ONLY. No DOM access, no event listening, no browser, no geometry
measurement — later items (16–19) consume this contract to do the actual checks.

## Context and linked canonical specs
- `docs/ads/PLACEMENT_MODEL.md` — the placement definition fields and the state
  machine (source of truth; implement it verbatim).
- `docs/specs/SPEC-006-AD-PLACEMENTS.md` — "Use stable application test hooks or
  emitted events rather than reverse-engineering vendor internals. The tool must
  not assert revenue or fill solely from DOM appearance." This contract records
  the classification of an already-observed signal; it makes NO revenue/fill
  claim and does no observing itself.
- Schema conventions to MIRROR from `src/domain/result.ts`: strict Zod objects,
  `z.output` as the single source of truth, and `rejectSecretLikeKeys(...)`
  applied to every serialized object shape. Error-subclass pattern to MIRROR
  from `src/visual/target.ts` (`VisualTargetError` → normalized
  `configuration_error`/`planning`).
- Error taxonomy (`src/domain/error.ts`): definition-validation failures are
  `configuration_error`/`planning`. (The runtime `placement_failure`/`assertion`
  category is for later checking features, NOT used here.)

## Non-goals
- Container presence/geometry/size checks (item 16).
- Request/render event capture (items 17–18).
- Layout-shift measurement (item 19).
- Any DOM access, Playwright import, event subscription, timing or browser work.
- Wiring placements into `ProjectConfig`/the scenario planner/orchestrator
  (a later feature exposes `PlacementDefinition[]` as config, mirroring how
  `VisualTarget` is still a code-level input). This feature is standalone.

## Proposed interfaces and files
New files (only these):
- `src/placements/model.ts` — Zod schemas + `z.output` types:
  - `PlacementSizeSchema` — `{ width: number.int().positive(), height: number.int().positive() }`.
  - `PlacementVisibilitySchema` — per-device expectation, e.g.
    `{ desktop: boolean, mobile: boolean }` (both default `true`).
  - `PlacementEventSignalsSchema` — `{ request?: string.min(1), render?: string.min(1) }`
    (documented app test-hook/event names; strings only, no secrets).
  - `PlacementDefinitionSchema` (`.strict()`, `rejectSecretLikeKeys('PlacementDefinition')`):
    `id` (stable slug, `min(1)`), `pages` (`string[].min(1)` — page paths/names the
    placement applies to; empty means "all"? NO — require explicit; see criteria),
    `containerSelector` (`min(1)`), `allowedSizes` (`PlacementSize[].min(1)`),
    `visibility` (`PlacementVisibilitySchema`, defaulted), `events`
    (`PlacementEventSignalsSchema`, optional), `timeoutMs`
    (`number.int().positive().default(...)`), `expectedEmpty` (`boolean.default(false)`
    — whether an `empty` terminal is an acceptable/expected outcome),
    `protectedRegions` (`string[]` of selectors, default `[]`), `screenshotTarget`
    (optional `string` name/selector — the later visual target hook, kept as a
    plain reference here, NOT a `VisualTarget`).
  - `PlacementStageSchema` = `z.enum(['applicability','container','request','render'])`.
  - `PlacementStateSchema` = `z.enum(['skipped','container_missing','container_ready',
    'request_missing','requested','rendered','empty','provider_error','timeout'])`
    (every non-start node of the state machine; `not_expected`/`expected`/
    `container_ready`/`requested` are transient — see classifier).
  - `PlacementObservationSchema` (`.strict()`, `rejectSecretLikeKeys`):
    `placementId` (`min(1)`), `state` (`PlacementStateSchema`), `stage`
    (`PlacementStageSchema`), `terminal` (`boolean`). NOTE: no raw response
    bodies, URLs, headers or vendor payloads — only the classification.
- `src/placements/state-machine.ts` — the pure classifier + terminal-set:
  ```ts
  export interface PlacementSignals {
    applicable: boolean;                 // expected vs not_expected
    containerFound?: boolean;            // container stage observation
    requestObserved?: boolean;           // request stage observation
    renderOutcome?: 'rendered' | 'empty' | 'provider_error' | 'timeout';
  }
  export const TERMINAL_PLACEMENT_STATES: ReadonlySet<PlacementState>;
  export function classifyPlacement(placementId: string, signals: PlacementSignals): PlacementObservation;
  export function isPlacementSatisfied(observation: PlacementObservation, definition: PlacementDefinition): boolean;
  ```
- `src/placements/index.ts` — barrel (`export *`).
- `tests/unit/placement-contract.spec.ts` — hermetic tests (no browser).
- `docs/STATUS.md` — one honest row (new "Placement contract" row; leave the
  existing "Ad placement checks" row unchanged).

## Behaviour — the state machine (verbatim from PLACEMENT_MODEL.md)
`classifyPlacement` evaluates signals **strictly in stage order**. A gate that
observes a FAILURE (`=== false`, or a failing `renderOutcome`) yields a TERMINAL
state and later signals are ignored. A gate whose signal is `undefined` means
"not yet observed at this stage" and yields a NON-terminal boundary reporting the
furthest confirmed transient node with `stage` = the stage currently awaited.
Encode this as this exact switch (no other interpretation):

```text
1. applicable === false            → { skipped,          applicability, terminal:true  }
2. containerFound === false        → { container_missing, container,     terminal:true  }
3. containerFound !== true         → { container_ready,   container,     terminal:false }   // undefined: awaiting container
   // container confirmed found
4. requestObserved === false       → { request_missing,   request,       terminal:true  }
5. requestObserved !== true        → { container_ready,   request,       terminal:false }   // undefined: awaiting request
   // request confirmed observed
6. renderOutcome === 'rendered'        → { rendered,       render, terminal:true }
   renderOutcome === 'empty'           → { empty,          render, terminal:true }
   renderOutcome === 'provider_error'  → { provider_error, render, terminal:true }
   renderOutcome === 'timeout'         → { timeout,        render, terminal:true }
7. renderOutcome === undefined     → { requested,         render,        terminal:false }   // awaiting render
```

Consequences (assert these):
- The only NON-terminal states ever returned are `container_ready` and
  `requested`; `not_expected`/`expected` are inputs (`applicable`), never returned.
- Ordering guarantees no impossible state: contradictory input such as
  `{ containerFound:false, requestObserved:true }` returns `container_missing`
  (gate 2 fires before any request logic).
- `observation.terminal` MUST equal `TERMINAL_PLACEMENT_STATES.has(state)` for
  every returned observation.

`isPlacementSatisfied(observation, definition)`:
- `skipped` → satisfied (not expected here).
- `rendered` → satisfied.
- `empty` → satisfied **iff** `definition.expectedEmpty === true`.
- any of `container_missing`, `request_missing`, `provider_error`, `timeout` →
  NOT satisfied.
- non-terminal (`container_ready`, `requested`) → NOT satisfied (incomplete).

`PlacementDefinitionSchema.parse` throws (via a `parsePlacementDefinition`
wrapper mirroring `parseRunManifest`) — but for the SPEC's normalized-error
requirement, ALSO export `PlacementDefinitionError extends Error` +
`parsePlacementDefinitionOrThrow(input)` that catches the ZodError and throws a
normalized `configuration_error`/`planning` error with a report-safe message
(field paths only, never values), mirroring `VisualTargetError`.

## Acceptance criteria
- [ ] `PlacementDefinitionSchema` validates a complete definition, applies
      documented defaults (`visibility` both `true`, `timeoutMs`, `expectedEmpty
      false`, `protectedRegions []`), and rejects unknown keys (`.strict`), an
      empty `id`, empty `containerSelector`, empty `allowedSizes`, and any
      secret-looking key.
- [ ] `classifyPlacement` returns EXACTLY the terminal state for each state-
      machine path: not-applicable→skipped; container missing→container_missing;
      request missing→request_missing; each `renderOutcome`→its terminal; and the
      correct NON-terminal boundary (`container_ready`/`requested`) when a later
      signal is `undefined`. Contradictory inputs (e.g. `requestObserved:true`
      but `containerFound:false`) still yield the earlier gate's terminal
      (`container_missing`) — asserted.
- [ ] `TERMINAL_PLACEMENT_STATES` contains exactly the terminal states and
      `observation.terminal` agrees with membership for every returned state.
- [ ] `isPlacementSatisfied` returns the truth table above, including
      `empty` gated on `expectedEmpty`.
- [ ] `parsePlacementDefinitionOrThrow` throws a normalized
      `configuration_error`/`planning` `PlacementDefinitionError` whose message
      contains offending field path(s) but NO field values, on invalid input.
- [ ] No `PlacementObservation` field can carry a secret (guarded) and the type
      carries no raw URL/header/body.

## Test plan
`tests/unit/placement-contract.spec.ts` (hermetic, no browser):
- Definition: a valid full example parses with defaults; a minimal example
  applies defaults; each rejection case (unknown key, empty id/selector/sizes,
  secret-like key) fails.
- State machine: one assertion per path listed in the acceptance criteria,
  including both non-terminal boundaries and the contradictory-input case; assert
  `terminal` matches `TERMINAL_PLACEMENT_STATES` for every case.
- `isPlacementSatisfied`: full truth table incl. `expectedEmpty` on/off for
  `empty`.
- `parsePlacementDefinitionOrThrow`: normalized category/phase and a message
  that names a field path but contains no supplied value.

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`. No browser; do NOT
  run the visual suite.

## Security/privacy impact
Pure data contract. `PlacementObservation` intentionally holds only a placement
id and a classification — no response bodies, URLs, headers or vendor payloads.
`rejectSecretLikeKeys` guards every serialized shape. Nothing is written to disk.

## Baseline impact
None. No screenshots taken or compared.

## Dependencies and risks
- Depends only on `zod` and `src/domain/error.js`.
- Risk: the classifier's `undefined`-boundary semantics must be encoded exactly
  as the single rule above; ambiguity is resolved in this SPEC, so no design
  question remains for the implementer.

## Handover notes
Additive module under `src/placements/`. Items 16–19 (container/request/render/
layout-shift checks) and config wiring are separate later tickets that consume
these types and `classifyPlacement`.
