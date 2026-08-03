# Feature: execution-run-contract

## Goal

Consolidate the missing execution contract: turn a REAL Playwright run into a
schema-valid domain `RunResult`, then produce and persist it
(`manifest.json`, `summary.json`, per-scenario `scenarios/<id>/result.json`).
Replace the prototype `src/orchestrator` `RunResult`
(`{ command, scenarioIds, exitCode }`) with the domain contract so #31
(dashboard-runner) can call one `executeRun(request): Promise<RunResult>` and #32
(report-viewer) can read a persisted `result.json`. Reuse the EXISTING pure
builders/writers — do not reimplement aggregation, manifest, run-id or paths.

## Context and linked canonical specs

- `docs/roadmap/IMPLEMENTATION_PLAN.md` — "Do not jump to dashboard work before
  the CLI/result/artifact contracts are verified." This is that verification.
- `docs/architecture/ARTIFACT_MODEL.md` / `DATA_FLOW.md` — the run directory
  layout (`<outputDir>/<runId>/manifest.json|summary.json|scenarios/<id>/result.json`).
- `src/domain/result.ts` — `ScenarioResult`, `RunResult`, `RunManifest`,
  `RunSummary`, `parseRunResult` (secret-key guards enforced on every payload).
- `src/reporting/aggregate.ts` — `buildRunResult`, `computeCounts`.
- `src/artifacts/*` — `buildRunManifest`, `buildRunSummary`, `newRunId`,
  `ensureRunDir`/`ensureScenarioDir`, `writeManifest`/`writeSummary`, `paths`
  (`scenarioResultPath`, `relativeArtifactRef`), all with traversal guards.
- `src/orchestrator/run-plan.ts` — `buildVisualRunPlan` (fail-fast plan).
- `tests/visual/scenarios.spec.ts` — the Playwright suite whose test titles are
  exactly `scenario.id`; it runs across 4 projects and `test.skip`s a scenario in
  the non-matching device project.
- `src/domain/error.ts` — `normalizeError(message, { category, phase })` used to
  turn raw Playwright error text into report-safe `NormalizedError`s.

## Non-goals

- No copying of per-scenario artifact FILES (screenshots/trace/video) into the
  run dir — only artifact REFS already known are recorded. (Artifact-file capture
  is a later item.)
- No HTML report writing wiring (that is #32); the #28 writer stays available.
- No dashboard runner/endpoints (#31) or report viewer (#32).
- No change to visual assertion or pass/fail semantics; the deterministic
  screenshot remains authoritative.
- No new runtime dependencies.

## Proposed interfaces and files (all under `src/orchestrator/`)

Split a PURE mapping core (hermetically testable) from a thin impure Playwright
adapter and a persistence step.

- `src/orchestrator/types.ts` — REPLACE the prototype `RunResult`. Define:
  - `RunRequest { config: ProjectConfig; scenarios: readonly Scenario[];
    updateSnapshots?: boolean }`.
  - Re-export the domain `RunResult` as the orchestrator's result type.
- `src/orchestrator/raw-outcome.ts` (PURE): `RawScenarioOutcome
  { scenarioId: string; status: 'passed'|'failed'|'skipped'; startedAt: string;
  finishedAt: string; durationMs: number; errorMessages: readonly string[];
  artifacts?: ArtifactRefs }` — a Playwright-agnostic per-scenario outcome.
- `src/orchestrator/playwright-report.ts` (PURE — operates on a parsed JS object,
  NO fs/spawn): `parsePlaywrightReport(report: unknown): RawScenarioOutcome[]` —
  extracts each spec's title (= scenarioId) and its result across projects and
  COLLAPSES per scenarioId (prefer a non-skipped result; a scenario skipped in
  every project stays skipped). Maps Playwright status
  (`passed`→passed; `failed`/`timedOut`/`interrupted`→failed; `skipped`→skipped),
  `duration`→`durationMs`, `startTime`→`startedAt`/`finishedAt`, and error
  `message`s → `errorMessages`. Tolerant of missing/extra fields; deterministic
  order = first-seen scenarioId.
- `src/orchestrator/collect-results.ts` (PURE): `collectScenarioResults(
  outcomes: readonly RawScenarioOutcome[], scenarios: readonly Scenario[]):
  ScenarioResult[]` — joins outcomes to planned `Scenario`s BY ID in planned
  order; each becomes a schema-valid `ScenarioResult` via `parseScenarioResult`
  (errors via `normalizeError(msg, { category: 'visual_regression'|..., phase:
  'assertion' })` — use a single sensible default category/phase for raw failures
  with severity `error`); a planned scenario with NO outcome is `skipped` with no
  errors. Never invents artifact files.
- `src/orchestrator/run.ts` — the SERVICE:
  `executeRun(request: RunRequest, deps?: ExecuteRunDeps): Promise<RunResult>`
  where `ExecuteRunDeps` injects (all defaulted): `now(): Date`,
  `newRunId(now): string`, `runSuite(args, env): Promise<unknown>` (the impure
  Playwright JSON runner), `resolveBrowserInfo(): { name, version }`,
  `writeManifest`/`writeSummary`/`writeScenarioResult`, `ensureRunDir`/
  `ensureScenarioDir`. Flow: `buildVisualRunPlan` (fail-fast) → `newRunId` →
  `startedAt` → `runSuite` with `VISUAL_SCENARIOS`=selected ids and
  `--update-snapshots` when requested → `parsePlaywrightReport` →
  `collectScenarioResults` → `finishedAt` → `buildRunManifest`
  (browser/config/scenarioIds) → `buildRunResult` → persist manifest, summary,
  and each scenario `result.json` → return the in-memory `RunResult`.
- `src/orchestrator/playwright-runner.ts` (IMPURE — the ONLY spawn/fs layer):
  `runPlaywrightSuite(args, env): Promise<unknown>` — spawns
  `npx playwright test tests/visual --reporter=json` to a temp file (or captures
  stdout JSON), parses and returns the report object. Isolated so `run.ts` stays
  testable with an injected fake.
- `src/artifacts/writer.ts` — ADD `writeScenarioResult(outputDir, runId,
  scenarioId, result: ScenarioResult): Promise<string>` (atomic, mirrors
  `writeManifest`), writing to `scenarioResultPath(...)`.
- `src/orchestrator/index.ts` — NEW barrel exporting the public contract
  (`RunRequest`, `executeRun`, and the pure helpers/types).
- `src/orchestrator/cli.ts` — rewrite to call `executeRun`, print the run id +
  summary path (NO secrets), and set `process.exitCode = result.deterministicFailure ? 1 : 0`.
- DELETE `src/orchestrator/orchestrator.ts` (the prototype `runVisualSuite`) once
  `run.ts` replaces it; keep `run-plan.ts` unchanged.

## Acceptance criteria

- [x] `parsePlaywrightReport` maps a representative Playwright JSON report to
      `RawScenarioOutcome[]`: status/duration/timestamps/errors mapped, results
      collapsed per scenarioId across projects (non-skipped wins), deterministic
      order, tolerant of missing fields.
- [x] `collectScenarioResults` returns schema-valid `ScenarioResult[]` in planned
      order, joining by id; unmatched planned scenarios are `skipped`; raw error
      messages become report-safe `NormalizedError`s (no secrets).
- [x] `executeRun` returns a schema-valid domain `RunResult`
      (`parseRunResult`-clean) with correct `counts`/`deterministicFailure`, using
      an injected fake `runSuite`; it persists `manifest.json`, `summary.json` and
      one `scenarios/<id>/result.json` per result under `<outputDir>/<runId>`.
- [x] The prototype `{ command, scenarioIds, exitCode }` `RunResult` is gone;
      `orchestrator.ts` deleted; `cli.ts` uses `executeRun` and exits non-zero on
      `deterministicFailure`.
- [x] No written file (manifest/summary/result) contains secret-shaped fields,
      auth state, cookies, headers or absolute paths (domain guards + relative
      refs enforce this).
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit`,
      `npm run test:integration` green.

## Test plan

- `tests/unit/playwright-report.spec.ts` (hermetic) — a committed
  representative Playwright-JSON fixture (object literal in the test): status
  mapping incl. `timedOut`/`interrupted`→failed, per-scenario collapse across a
  desktop+mobile project pair, missing-field tolerance, deterministic order.
- `tests/unit/collect-results.spec.ts` (hermetic) — join-by-id + planned order;
  unmatched scenario → skipped; error normalization is report-safe; output is
  `parseScenarioResult`-clean; no secret leakage.
- `tests/unit/execute-run.spec.ts` (hermetic) — `executeRun` with an injected
  fake `runSuite` (returns a fixture report), a fixed `now`/`newRunId`, and
  writers pointed at an injected in-memory/temp sink: asserts a
  `parseRunResult`-clean `RunResult`, correct counts/deterministicFailure, and
  that manifest/summary/result writes were issued for the run + each scenario.
  If a real temp dir is used it must be created/cleaned within the test and is
  therefore placed in `tests/integration/` instead to honour unit hermeticity.
- `tests/integration/execute-run-persist.spec.ts` (if fs is exercised) — run
  `executeRun` with a fake `runSuite` but the REAL writers against an
  `mkdtemp` dir; assert the three file kinds exist, parse clean, and are
  secret-free; clean up.
- The thin `runPlaywrightSuite` spawn wrapper is left uncovered by design (a
  minimal child-process/JSON-parse shim, mirroring the current untested spawn);
  note this in the PR.

## Security/privacy impact

`type:security`. Surfaces: (1) child-process spawn — only the fixed Playwright
CLI is invoked; env passes non-secret test signals (`VISUAL_SCENARIOS`, country/
ads headers already used by the suite), never credentials; (2) result/manifest
serialization — every payload passes the domain secret-key guards and error text
is normalized via `normalizeError`→`redactSecrets`; (3) artifact refs are
RELATIVE (traversal-guarded by `paths.ts`); no absolute paths, cookies, auth
state or headers are ever written. A `security-review` subagent pass runs before
merge.

## Baseline impact

None (does not change baselines; `--update-snapshots` is passed through only when
the caller requests it, unchanged from today).

## Dependencies and risks

- Depends on `src/domain`, `src/reporting/aggregate`, `src/artifacts`,
  `src/orchestrator/run-plan`, `src/scenarios`. No new npm deps.
- Risk: Playwright JSON shape drift — mitigated by keeping `parsePlaywrightReport`
  tolerant and isolated, covered by a fixture test, and confining the real spawn
  to a thin swappable adapter.
- Risk: multi-project collapse correctness — covered explicitly by fixture tests.

## Handover notes

Execute with Sonnet against this spec. Keep `raw-outcome`/`playwright-report`/
`collect-results`/`run` PURE (inject the runner, clock, run-id and writers);
confine spawn+fs to `playwright-runner.ts`. Reuse existing builders/writers; do
NOT reimplement aggregation/manifest/paths. After implementation: independent
review + `security-review` subagent, then update `docs/STATUS.md` (new row) and
check the boxes.
