# Feature: artifact-layout

Roadmap item #5 (Foundation). Tracking issue: #9.

## Goal

Provide the deterministic **artifact layout** foundation: sortable/unique
**run IDs**, a **path builder** that mirrors `docs/architecture/ARTIFACT_MODEL.md`
exactly, and builders/writers for a secret-free **RunManifest** and
**RunSummary** (`manifest.json` / `summary.json`). This is what every later
browser/reporting feature will write into. No browser, no orchestration.

## Context and canonical references

- `docs/architecture/ARTIFACT_MODEL.md` — the authoritative directory layout
  (reproduced below) and the manifest "must exclude secrets" rule.
- `src/domain/result.ts` — `RunManifest`, `RunSummary`, `ArtifactRefs`,
  `RunCounts` schemas + `parseRunManifest`/`parseRunSummary` (import via
  `src/domain/index.js`). These are the contracts you MUST satisfy — do not
  redefine them.
- `src/config/schema.ts` — `ArtifactPolicy.outputDir` (default `'reports'`) is
  the configurable base directory; `retainOnFailureOnly` is documented here but
  its pruning logic is out of scope.

### Canonical layout (root it at `outputDir`, not a hardcoded `artifacts/`)

```text
<outputDir>/<run-id>/
  manifest.json
  summary.json
  report/index.html            # path only; rendering is a later feature
  scenarios/<scenario-id>/
    result.json
    expected.png  actual.png   diff.png
    console.json  page-errors.json  requests.json
    trace.zip     video.webm   ai-analysis.json
```

## Non-goals

- No browser launch, no artifact *capture* (screenshots/traces) — later.
- No HTML report rendering (only the `report/index.html` path is produced).
- No retention/pruning implementation (document the policy; do not delete).
- Do NOT modify `src/config/*`, `src/domain/*`, `src/scenarios/*` or
  `tests/visual/*`. This feature is ADDITIVE under a new `src/artifacts/`.

## Proposed interfaces and files (new, under `src/artifacts/`)

- `src/artifacts/run-id.ts`
  - `newRunId(now?: Date): string` — sortable, filesystem-safe, unique run ID,
    e.g. `20260731T135200Z-a1b2c3` (UTC compact timestamp + short random
    suffix). Injectable clock for tests. Also export a validation regex /
    `isRunId(value): boolean`.
- `src/artifacts/paths.ts`
  - `ARTIFACT_FILENAMES` — the exact mapping from `ArtifactRefs` keys to the
    canonical filenames (`expected`→`expected.png`, `actual`→`actual.png`,
    `diff`→`diff.png`, `console`→`console.json`, `pageErrors`→`page-errors.json`,
    `requests`→`requests.json`, `trace`→`trace.zip`, `video`→`video.webm`,
    `aiAnalysis`→`ai-analysis.json`). Plus `result.json`.
  - `runDir(outputDir, runId)`, `manifestPath(...)`, `summaryPath(...)`,
    `reportIndexPath(...)`, `scenarioDir(outputDir, runId, scenarioId)`.
  - `scenarioArtifactPath(outputDir, runId, scenarioId, kind)` — absolute path.
  - `relativeArtifactRef(scenarioId, kind)` — the path RELATIVE to the run dir
    (e.g. `scenarios/<id>/actual.png`) suitable for a domain `ArtifactRefs`
    value (which forbids absolute paths). Provide a helper that assembles an
    `ArtifactRefs` object for a given set of present artifact kinds.
  - Paths must be built with `node:path` and stay INSIDE the run dir (guard
    against `..`/absolute scenario IDs — planner IDs are already slugged, but
    validate defensively).
- `src/artifacts/manifest.ts`
  - `buildRunManifest(input): RunManifest` — assembles and returns a manifest
    validated via `parseRunManifest`. Inputs: `toolVersion` (read from
    `package.json` `version`), optional `commitSha`, `os` (e.g.
    `${process.platform} ${process.arch}` or `os.release()`), `browser`
    (`{name, version}` passed in — no browser is launched here), `config`
    (ProjectConfig, used to compute `configHash`), optional `baselineHash`,
    `scenarioIds`, `createdAt` (ISO). Compute `configHash` as a STABLE
    sha256 over a canonicalized (sorted-key) JSON of the config. Never place
    secrets in the manifest (the domain schema already rejects secret-looking
    keys — rely on it and add a canonicalizer that drops nothing secret since
    config carries none, but do NOT serialize env/process data).
  - `buildRunSummary(input): RunSummary` — from `runId`, timestamps, `counts`,
    `deterministicFailure`; validated via `parseRunSummary`.
  - A stable canonical-JSON hash helper (`node:crypto`).
- `src/artifacts/writer.ts`
  - `ensureRunDir(outputDir, runId)` — mkdir -p the run dir + `report/`.
  - `writeManifest(outputDir, runId, manifest)` and
    `writeSummary(outputDir, runId, summary)` — write pretty JSON atomically
    (write temp then rename) and return the absolute path written.
  - `ensureScenarioDir(outputDir, runId, scenarioId)`.
  - Must never write outside `outputDir`. No deletion/pruning.
- `src/artifacts/index.ts` — barrel.

## Acceptance criteria

- [ ] `newRunId()` returns sortable, unique, filesystem-safe IDs; two calls at
      the same instant differ; lexical sort == chronological order; `isRunId`
      accepts them and rejects junk.
- [ ] Path builders reproduce `ARTIFACT_MODEL.md` exactly, rooted at
      `outputDir`; every `ArtifactRefs` key maps to the documented filename;
      `relativeArtifactRef` values are relative (accepted by `ArtifactRefsSchema`)
      and resolve back inside the run dir.
- [ ] `buildRunManifest` returns a schema-valid `RunManifest`; `configHash` is
      identical for deeply-equal configs regardless of key order and changes
      when the config changes; the manifest contains no secret-looking fields.
- [ ] `buildRunSummary` returns a schema-valid `RunSummary`.
- [ ] Writers create the directory tree and write valid `manifest.json` /
      `summary.json` that round-trip through `parseRunManifest`/`parseRunSummary`;
      nothing is written outside `outputDir`; writing is idempotent.
- [ ] `npm run typecheck` and `npm run lint` exit 0; unit tests pass; a
      `docs/STATUS.md` row for the artifact layer is updated honestly (paths +
      manifest implemented; capture/retention still pending).

## Test plan

- `tests/unit/artifacts.spec.ts` (Playwright `test` runner, pure/fs, NO browser;
  mirror `tests/unit/domain.spec.ts` style). Cover every acceptance bullet.
  Filesystem tests MUST use a unique temp dir under `os.tmpdir()` and clean up
  in a `finally`; never write into the repo tree.
- Manually: build a manifest+summary from `visual-qa.config.ts` and the planner
  scenario IDs, write them to a temp dir, and re-parse.
- `npm run typecheck` → 0, `npm run lint` → 0, `npx playwright test tests/unit`
  → all pass. Do NOT run the visual suite.

## Security/privacy impact

The manifest/summary are report-safe: only tool/os/browser/config-hash/scenario
IDs — never API keys, auth headers, cookies or storage state (enforced by the
domain schema's secret-key rejection plus not serializing any env/process
secrets). `configHash` is a one-way sha256, not the raw config.

## Baseline impact

None. (Layout only; `baselineHash` is passed through if provided.)

## Dependencies and risks

- Depends on #3 (domain) and #2 (config), both merged; consumes planner IDs
  from #4 but does not import the planner (IDs are plain strings).
- Risk: layout drift vs ARTIFACT_MODEL later breaks reporting. Mitigation: a
  single source of truth (`ARTIFACT_FILENAMES` + path helpers) covered by tests
  asserting the exact filenames.
- Risk: run-ID collisions. Mitigation: timestamp + random suffix + collision
  test; document the format.

## Handover notes

Well-scoped for Sonnet 5. Highest-value tests: run-ID sortability/uniqueness,
exact filename mapping, `configHash` key-order stability, and writer staying
inside `outputDir`. Write those first
(`skills/superpowers/test-driven-development`), commit frequently, and run
`skills/superpowers/verification-before-completion` before the PR (`Closes #9`).
Escalate to Opus only if the layout must diverge from ARTIFACT_MODEL or the
run-ID format needs a cross-feature decision.
