# Feature: live-placement-container-checks

## Goal

Make ad **container checks run in a real browser**. Expose `PlacementDefinition[]`
in `ProjectConfig`, select the placements applicable to each scenario's page, read
the container's real DOM state and assert presence/visibility/size — the first
live consumer of the placement contract (#33) and the container-check module
(#35). Pass/fail is decided by explicit deterministic rules (Playwright +
`assertContainer`), never by an LLM.

## Context and linked canonical specs

- `docs/ads/PLACEMENT_MODEL.md` — the canonical placement fields + state machine.
- `docs/features/placement-contract/SPEC.md` (#33), `docs/features/placement-container-checks/SPEC.md` (#35) — the pure contract + container reader/evaluator this wires in unchanged.
- `docs/specs/SPEC-006-AD-PLACEMENTS.md` — the ad-placement feature spec.
- `AGENTS.md` — "Playwright and explicit rules decide pass/fail; an LLM never does."

## Non-goals

- Request/render event capture and the real event bridge (items 18/19).
- Layout-shift wiring (#41), overlap/`protectedRegions`.
- Embedding `PlacementObservation`s into `result.json`/reports (a later slice — `assertContainer` is the authoritative pass/fail here).
- Any fill/revenue claim; committing a real ad target or ad baselines.

## Proposed interfaces and files

- `src/config/schema.ts` — `ProjectConfigSchema` gains `placements: PlacementDefinition[]` (default `[]`), reusing the existing strict, secret-guarded `PlacementDefinitionSchema` (no redefinition).
- `src/placements/select.ts` (new) — pure `placementsForScenario(placements, scenario)`: returns placements whose `pages` reference the scenario page by `page.path` or optional `page.name`; device applicability is intentionally NOT filtered (the evaluator asserts the per-device expectation, including "must be absent on this device"). No fs/Date/random/env/DOM; input order preserved. Barrelled via `src/placements/index.ts`.
- `src/orchestrator/run-plan.ts` — `ScenarioWorkItem` gains `placements: PlacementDefinition[]`, populated via `placementsForScenario(config.placements ?? [], scenario)` in `buildVisualRunPlan`.
- `tests/visual/scenarios.spec.ts` — after `preparePage`, before the screenshot assertions, each `workItem.placements` entry has its container read (`readContainerState`) and asserted (`evaluateContainer` + `assertContainer`). A no-op when no placements are configured.

## Acceptance criteria

- [x] `placements` validates (default `[]`; strict; secret-like keys rejected); an empty/absent `placements` keeps the current green run unchanged (no-op).
- [x] `placementsForScenario` returns exactly the placements whose `pages` match the scenario page (by path or name), deterministically and purely.
- [x] Each `ScenarioWorkItem.placements` is populated from config for its scenario's page.
- [x] The visual suite reads each configured placement's container and fails the test via `assertContainer` on wrong presence/visibility/size, with a report-safe message that never leaks the selector value.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` all pass with new hermetic tests (selector + run-plan threading + config schema).

## Test plan

- Hermetic units: `tests/unit/placement-select.spec.ts` (page/name matching, no-name guard, device-agnostic selection, order, no-mutation); `tests/unit/end-to-end-run-plan.spec.ts` (placements default `[]`; page-applicable threading); `tests/unit/config.spec.ts` (placements default/valid/defaulted sub-fields; secret-field rejection). Existing `placement-container-checks.spec.ts` already covers the reader/evaluator/assert exhaustively.
- Real-browser verification (local cached Chromium, example.com): the committed `placements: []` run stays GREEN 8 passed / 8 skipped; a throwaway placement with a missing container made the run FAIL with `Placement "<id>" container check failed: container missing` (selector value NOT leaked), proving the wiring executes in a browser. Both the temporary placement and the local `executablePath` tweak were reverted (never committed).

## Security/privacy impact

Low. Reuses the secret-guarded `PlacementDefinitionSchema`; observations/errors carry only ids/booleans/numbers (no selector value or page content). No new secrets, network calls, or artifacts. `type:feature`.

## Baseline impact

None. Adds no baselines and takes no new screenshots; container checks are geometry/DOM assertions, independent of the snapshot baselines.

## Dependencies and risks

- Depends on #31/#33/#35 (all merged, pure). No runtime dependency changes.
- Risk: a misconfigured `allowedSizes`/selector could fail runs — mitigated by the report-safe error naming only the placement id + reason, and by `placements` being opt-in (default `[]`).

## Handover notes

Configure real ad placements in `visual-qa.config.ts` against an ad-serving target to exercise this live. Next slices: the real Playwright event bridge (request/render, items 18/19) and embedding `PlacementObservation`s into the report.
