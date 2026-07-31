# Feature: domain-result-types

Roadmap item #3 (Foundation). Tracking issue: #5.

## Goal

Define the **provider-neutral domain contracts** every later feature depends on:
normalized scenarios, results, runs, run manifest, and a secret-safe error
model. Includes Zod schemas so the serialized JSON artifacts (`result.json`,
`summary.json`, `manifest.json`) have one authoritative shape.

## Context and linked canonical specs

- `docs/architecture/ERROR_MODEL.md` — the 12 error categories + error fields.
- `docs/architecture/DATA_FLOW.md` — phases 1–14; results are normalized at 12.
- `docs/architecture/ARTIFACT_MODEL.md` — manifest/summary/result shapes and the
  fields that MUST be excluded (API keys, auth headers, cookie values, storage).
- `docs/architecture/MODULE_MAP.md` — new code lives in `src/domain/`.
- `docs/specs/SPEC-001-SCENARIO-ENGINE.md` — scenario dimensions/ID expectations
  (this feature defines the TYPE only; expansion is #4).

## Non-goals

- No scenario expansion, filters, IDs or dry-run (that is #4).
- No artifact path building, run-id generation or manifest writing (that is #5).
- No reporting/HTML (that is #28), no redaction transport to AI (#25).
- Do NOT rip out or rewrite `src/scenarios/scenarios.ts`; this feature is
  additive. Reconciling the example scenarios with the new `Scenario` type is a
  later feature's job.

## Proposed interfaces and files

- `src/domain/error.ts`:
  - `ErrorCategory` union — exactly the 12 categories from ERROR_MODEL.
  - `Phase` union — the pipeline phases (`configuration`, `planning`,
    `context_setup`, `navigation`, `state_verification`, `readiness`,
    `assertion`, `diagnostics`, `artifacts`, `reporting`, `ai_analysis`).
  - `NormalizedError` interface: `code` (stable string), `category`, `message`
    (report-safe), `scenarioId?`, `phase`, `timestamp` (ISO), `severity`
    (`error` | `warning`), `evidenceRefs?` (string[]).
  - `normalizeError(input, context)` helper: maps any thrown value into a
    `NormalizedError` WITHOUT leaking secrets or raw stack traces into
    `message`. AI-provider failures default to `severity: 'warning'` and never
    become deterministic failures.
  - A small redaction guard so obvious secret patterns (auth headers, cookie
    values, `sk-`/api-key-like tokens) are stripped/replaced in messages.
- `src/domain/result.ts`:
  - `ScenarioStatus` = `'passed' | 'failed' | 'skipped'`.
  - `Scenario` — provider-neutral resolved instance: `id`, `page` ({path,name?}),
    `device`, `consent`, `country`, `adsEnabled`, optional `userFixture`/`tags`.
  - `ArtifactRefs` — optional relative paths (expected/actual/diff/console/
    pageErrors/requests/trace/video/aiAnalysis) as strings, no absolute paths.
  - `ScenarioResult` — `scenario`, `status`, `errors: NormalizedError[]`,
    `startedAt`, `finishedAt`, `durationMs`, `artifacts?: ArtifactRefs`.
  - `RunManifest` — `toolVersion`, `commitSha?`, `os`, `browser`
    ({name,version}), `configHash`, `baselineHash?`, `scenarioIds: string[]`,
    `createdAt`. MUST NOT contain secret fields.
  - `RunResult` — `runId`, `startedAt`, `finishedAt`, `manifest`,
    `results: ScenarioResult[]`, `counts` ({passed,failed,skipped,total}),
    `deterministicFailure: boolean` (drives CLI exit code).
  - `RunSummary` — compact serializable subset for `summary.json`.
- `src/domain/schema.ts` (or per-file Zod): Zod schemas mirroring the above
  (`.strict()`), with `z.output` inferred types re-exported. Provide type guards
  / `parseX` helpers used to validate serialized artifacts.
- `src/domain/index.ts` — barrel re-export.

## Acceptance criteria

- [ ] `src/domain/` exports the error + result contracts and matching Zod
      schemas; inferred types equal the hand-written interfaces (compile-checked).
- [ ] `ErrorCategory` contains exactly the 12 ERROR_MODEL categories.
- [ ] `normalizeError()` categorizes, sets a stable code + ISO timestamp, and
      produces a message with NO secret/stack leakage; AI-provider input →
      `severity: 'warning'`.
- [ ] Manifest/result/summary Zod schemas reject unknown keys and reject any
      object carrying a secret-looking field (e.g. `apiKey`, `authorization`,
      `cookie`) — enforced by a strict schema + a guard test.
- [ ] `deterministicFailure` is true iff at least one non-skipped result has a
      non-warning error / failed status; AI warnings alone never set it true.
- [ ] Unit tests cover: category completeness, normalizeError redaction + AI
      warning, schema round-trip (serialize→parse), unknown-key rejection,
      secret-field rejection, and deterministicFailure logic.
- [ ] `npm run typecheck` and `npm run lint` exit 0. `docs/STATUS.md` updated
      (new "Domain result/error contracts" row → implemented).

## Test plan

- `tests/unit/domain.spec.ts` (Playwright `test` runner, pure functions, no
  browser). Assert every acceptance bullet.
- `npm run typecheck` → 0, `npm run lint` → 0. Do NOT run the visual suite.

## Security/privacy impact

Central to this feature: the error normalizer and strict schemas are the guard
that stops secrets, auth headers, cookies and raw stacks from reaching
`result.json`/`summary.json`/`manifest.json` or AI evidence. Tests must prove
redaction and secret-field rejection.

## Baseline impact

None.

## Dependencies and risks

- Depends on #1 and #2 (merged): pinned Zod, working lint.
- Risk: overlap with scenario-planner (#4) / artifact-layout (#5). Mitigation:
  define TYPES and validation only; no expansion, path building or writing.
- Risk: keeping hand-written interfaces and Zod-inferred types in sync.
  Mitigation: derive types from Zod (`z.output`) as the single source, or add a
  compile-time equality assertion.

## Handover notes

Well-scoped execution after this spec — suitable for Sonnet 5. The redaction and
secret-rejection behaviour is the highest-risk part; write those tests first
(`skills/superpowers/test-driven-development`) and run
`skills/superpowers/verification-before-completion` before the PR (`Closes #5`).
Escalate to Opus only if a contract choice forces a cross-feature decision.
