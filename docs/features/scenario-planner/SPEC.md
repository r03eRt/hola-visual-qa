# Feature: scenario-planner

Roadmap item #4 (Foundation). Tracking issue: #7.

## Goal

Deterministically expand the project configuration (pages x dimensions) into
normalized domain `Scenario[]` with **stable, human-readable IDs**, apply
include/exclude filters, enforce a maximum-scenario safety guard, validate
impossible combinations **before any browser launches**, and provide a
**dry-run** that prints the plan.

## Context and linked canonical specs

- `docs/specs/SPEC-001-SCENARIO-ENGINE.md` — the canonical requirements.
- `docs/architecture/DATA_FLOW.md` — steps 3-5 (expand, filter, safety limits).
- `src/domain/result.ts` — the `Scenario` contract this produces.
- `src/config/schema.ts` + `load-config.ts` — the validated input.

## Non-goals

- No browser launch, orchestration or concurrency (#6+).
- No artifact/run-id/manifest writing (#5).
- Do NOT modify `src/config/schema.ts` (filters/limits are planner inputs here,
  not new config fields) or rewrite `src/scenarios/scenarios.ts` /
  `tests/visual/*`. Reconciling the visual test to consume the planner is a
  later Browser-MVP feature.

## Proposed interfaces and files

- `src/scenarios/id.ts` — `buildScenarioId(parts)`: derive a stable ID from
  **normalized** dimensions (not array order), e.g.
  `home-desktop-accepted-es-ads_on`. Deterministic slugging; documented format.
- `src/scenarios/filter.ts` — `ScenarioFilter` type + `matchesFilter()`:
  include/exclude by `pages` (path or name), `tags`, `devices`, `consent`,
  `countries`, `ads`, plus explicit `excludeCombinations` (partial dimension
  matches). Include rules narrow; exclude rules remove; exclude wins.
- `src/scenarios/planner.ts`:
  - `planScenarios(config: ProjectConfig, options?: PlanOptions): ScenarioPlan`.
  - `PlanOptions`: `{ filter?: ScenarioFilter; maxScenarios?: number }`
    (`maxScenarios` default e.g. 500).
  - Cartesian expansion of `pages x device x consent x country x ads` into
    `Scenario` objects (domain type), **sorted by ID** for stable ordering.
  - `ScenarioPlan`: `{ scenarios: Scenario[]; totalBeforeFilter: number;
    excludedCount: number; }`.
  - Validation (throws a normalized `configuration_error`, phase `planning`,
    BEFORE any browser):
    - empty plan after filtering (no scenarios to run);
    - duplicate IDs (collision) — should be impossible, but assert and fail;
    - plan size exceeding `maxScenarios`.
  - Use `normalizeError`/`ConfigValidationError`-style errors from `src/domain`.
- `src/scenarios/plan-cli.ts` + `npm run plan` script — dry-run that calls
  `loadConfig()` + `planScenarios()` and prints the ordered scenario IDs (and
  counts) to stdout, applying simple `--page`/`--device`/`--country`/`--tag`
  and `--max` flags. Never launches a browser. Exit non-zero on validation
  failure.
- `src/scenarios/index.ts` — barrel (does not re-export the legacy example).

## Acceptance criteria

- [ ] The same config always yields the same **ordered** scenario IDs (stable,
      normalized, not dependent on input array order).
- [ ] Excluded combinations never appear in the plan; include filters narrow it.
- [ ] Invalid/empty/oversized plans throw a normalized `configuration_error`
      (phase `planning`) before any browser work; the dry-run exits non-zero.
- [ ] `maxScenarios` guard enforced; duplicate IDs are detected and rejected.
- [ ] `npm run plan` prints the ordered plan + counts and launches no browser.
- [ ] Unit tests cover: expansion count/shape, ID stability under reordered
      dimension arrays, include & exclude filters, empty-plan error, max-guard
      error, collision detection.
- [ ] `npm run typecheck` and `npm run lint` exit 0; `docs/STATUS.md` "Scenario
      matrix" row updated (expansion/filters/dry-run now implemented).

## Test plan

- `tests/unit/scenario-planner.spec.ts` (Playwright `test` runner, pure
  functions, no browser). Assert every acceptance bullet, including ID stability
  by shuffling dimension arrays and comparing ordered IDs.
- Manually: `npm run plan` and `npm run plan -- --device desktop --country ES`.
- `npm run typecheck` -> 0, `npm run lint` -> 0. Do NOT run the visual suite.

## Security/privacy impact

None directly. The dry-run prints only scenario IDs/dimensions (no secrets, no
URLs beyond configured paths). The pre-browser validation reduces the chance of
launching against an unintended matrix.

## Baseline impact

None.

## Dependencies and risks

- Depends on #1-#3 (merged): config loader, domain `Scenario`, normalizeError.
- Risk: ID format churn later breaks baselines. Mitigation: document the ID
  format explicitly and cover it with a stability test now.
- Risk: scope creep into config (exclude rules/limits). Mitigation: keep those
  as planner options in this PR; a config-driven exclude list can be a later
  additive change.

## Handover notes

Well-scoped execution — suitable for Sonnet 5. ID stability and the pre-browser
validation are the highest-value tests; write them first
(`skills/superpowers/test-driven-development`). Commit frequently. Run
`skills/superpowers/verification-before-completion` before the PR (`Closes #7`).
Escalate to Opus if the ID format or an exclude-semantics choice needs a
cross-feature decision.
