# Feature SPEC — baseline-update-command (#11)

Ticket: #23 · Branch: `feature/baseline-update-command` · Roadmap: Browser MVP
Canonical: `docs/specs/SPEC-004-VISUAL-ENGINE.md` (baseline rules), `docs/specs/SPEC-012-CLI.md` (CLI requirements)

## Why (non-negotiable rules this enforces)
- Baselines are NEVER updated automatically after a failure.
- A snapshot change requires a WRITTEN REASON and human review.
- Updating baselines requires an EXPLICIT command.
This feature is the *safety envelope* around baseline promotion: an explicit,
reasoned, audited, dry-runnable command. It NEVER decides pass/fail and NEVER
runs as a side effect of a test run.

## Scope
Deliver a committed baseline store + a pure/DI promotion engine + its CLI.

### NON-goals (explicitly deferred — do not build)
- Auto-discovery of update candidates from a completed run directory. The
  snapshot runner does not yet exist and `result.json` does not yet carry
  `baselineName`/target metadata, so promotion here is driven by EXPLICIT
  caller input (`--scenario`+`--target`+`--source`). Auto-discovery is a later
  feature. Say so in `docs/STATUS.md`.
- Capturing/comparing screenshots or running Playwright.
- Editing `playwright.config.ts` snapshot templates (the consuming runner is
  later; keep this additive).

## Baseline store (committed, reviewable in PRs)
- Committed directory `baselines/` at repo root. Path per image:
  `baselines/<project>/<baselineName>.png` where `<project>` ∈
  `desktop-chromium | mobile-chromium` and `<baselineName>` comes from
  `src/visual` (`baselineName()`, already partitioned by browser/platform/device).
- Add a `baselines/.gitkeep` and a short `baselines/README.md` explaining that
  every file here is a reviewed baseline and changes require a PR + written
  reason. Do NOT add `baselines/` to `.gitignore` (it MUST be committed).
- Path builders live in `src/baseline/paths.ts` with the same traversal-safety
  guards as `src/artifacts/paths.ts` (reject absolute/`..`/separator-injected
  segments; assert the result stays inside `baselines/`). Reuse that file's
  approach — mirror `assertSafeSegment`/`assertInside`.

## New files (only these)
- `src/baseline/paths.ts` — `baselineStoreDir()`, `baselinePath(project, baselineName)`, `auditLogPath()`.
- `src/baseline/plan.ts` — PURE planning (below).
- `src/baseline/apply.ts` — impure shell over injected `FileSystemLike` + `Clock`.
- `src/baseline/cli.ts` — arg parsing + orchestration + exit codes.
- `src/baseline/index.ts` — barrel (`export *`).
- `tests/unit/baseline-update-command.spec.ts` — hermetic unit tests (fake fs/clock).
- `baselines/.gitkeep`, `baselines/README.md` (new committed store).
- `package.json` — add ONE script: `"baseline:update": "tsx src/baseline/cli.ts"` (this is the feature's entry point; do not touch any other script).
- `docs/STATUS.md` — honest row for baseline management.

## Pure planning — `plan.ts`
```ts
export interface UpdateRequest {
  scenarioId: string;
  targetId: string;         // from src/visual targetId()
  baselineName: string;     // from src/visual baselineName()
  project: 'desktop-chromium' | 'mobile-chromium';
  sourceActualPath: string; // path to the fresh actual.png to promote
}
export type UpdateActionKind = 'create' | 'overwrite';
export interface PlannedUpdate {
  scenarioId: string; targetId: string; baselineName: string;
  project: string; from: string; to: string; kind: UpdateActionKind;
}
export interface BaselineUpdatePlan {
  reason: string;
  updates: PlannedUpdate[];
  rejected: { request: UpdateRequest; message: string }[];
}
export interface PlanInput {
  requests: UpdateRequest[];
  reason: string;
  baselineExists: (project: string, baselineName: string) => boolean;
  sourceExists: (sourceActualPath: string) => boolean;
}
export function planBaselineUpdate(input: PlanInput): BaselineUpdatePlan;
```
Rules (deterministic, pure — no fs/Date/random/env; existence checks are injected):
- `reason` MUST be non-empty after trim; else throw a `BaselineUpdateError`
  (small Error subclass with `.normalized`, category `configuration_error`,
  phase `planning`) — mirror the pattern in `src/visual/target.ts`.
- A request whose `sourceExists(...)` is false → goes to `rejected` (missing
  actual to promote), NOT to `updates`. Never fabricate a baseline.
- `kind` = `overwrite` if `baselineExists(...)` else `create`; `to` =
  `baselinePath(project, baselineName)`, `from` = `sourceActualPath`.
- Deterministic ordering (input order preserved). Empty selection → empty plan.

## Impure apply — `apply.ts`
```ts
export interface FileSystemLike {
  exists(path: string): boolean;
  mkdirp(dir: string): void;
  copyFile(from: string, to: string): void;
  appendFile(path: string, data: string): void;
}
export interface Clock { now(): string; }   // ISO timestamp
export interface ApplyOptions {
  allowOverwrite: boolean;        // from --yes
  toolVersion: string;            // caller supplies (package version)
  commitSha?: string;             // optional, may be absent
}
export interface AuditEntry {
  timestamp: string; reason: string; toolVersion: string; commitSha?: string;
  updates: { scenarioId: string; targetId: string; baselineName: string; project: string; kind: UpdateActionKind }[];
}
export interface ApplyResult { applied: PlannedUpdate[]; skipped: { update: PlannedUpdate; message: string }[]; audit?: AuditEntry; }
export function applyBaselineUpdate(plan: BaselineUpdatePlan, fs: FileSystemLike, clock: Clock, opts: ApplyOptions): ApplyResult;
```
- An `overwrite` update with `allowOverwrite === false` is SKIPPED (not applied)
  with a message telling the user to pass `--yes`; `create` updates always apply.
- For each applied update: `mkdirp(dirname(to))` then `copyFile(from,to)`.
- If ≥1 update applied, append ONE JSON line to `auditLogPath()` (an
  append-only `baselines/UPDATE_LOG.jsonl`) built from `clock.now()` + reason +
  applied updates; return it as `audit`. If nothing applied, no audit line.
- The audit entry MUST be secret-free: only ids/paths-relative-names/reason/
  version/sha. Never write cookie values, headers, URLs with query secrets, etc.
- Pure-ish: all side effects go through injected `fs`/`clock` so unit tests are
  hermetic (inject an in-memory fake). No direct `node:fs`/`Date` in this module.

## CLI — `cli.ts`
Flags: `--scenario <id>` (repeatable), `--target <targetId>` (repeatable, pairs
positionally or applies to all — keep it simple: require one `--target` per
`--scenario` in the same order, else usage error), `--baseline-name <name>`
(repeatable, same pairing), `--project <desktop-chromium|mobile-chromium>`,
`--source <path>` (repeatable, the actual.png to promote), `--reason "<text>"`
(REQUIRED), `--yes` (confirm overwrite), `--dry-run`, `--json`, `--help`.
- `--help` prints usage and exits 0.
- Missing/blank `--reason` OR empty selection OR mismatched pairing → print the
  normalized, report-safe message (no stack trace) and exit `2` (usage error).
- `--dry-run`: build the plan, print it (human or `--json`), touch NOTHING, exit
  0 (or `3` if the plan has zero updates and zero rejections).
- Real run: build plan → `applyBaselineUpdate` with real `node:fs`-backed
  `FileSystemLike` + a real `Clock`, `toolVersion` from `package.json` version,
  `commitSha` from `process.env.GITHUB_SHA` if present (optional). Print result.
- Exit codes: `0` success (≥1 applied or clean dry-run); `2` usage error; `3`
  nothing to do (empty plan); `4` refused — plan had overwrites but `--yes` was
  not given and none were applied. `--json` emits a single machine-readable
  object to stdout; all diagnostics go to stderr.
- NEVER launches a browser. NEVER runs automatically.

## Acceptance criteria
- Running without `--reason` refuses with exit 2 and changes nothing.
- `--dry-run` lists planned create/overwrite actions and writes nothing.
- A `create` promotes the source actual to `baselines/<project>/<name>.png`.
- An `overwrite` is refused (exit 4 / skipped) unless `--yes` is passed.
- A selection whose source actual is missing is rejected, never fabricated.
- Every applied run appends exactly one secret-free JSON line to
  `baselines/UPDATE_LOG.jsonl` including the written reason and timestamp.
- All error paths throw/emit a normalized `configuration_error`/`planning`.

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- Unit tests hermetic: inject fake `FileSystemLike`/`Clock`; NO real fs writes,
  NO browser. Do NOT run the visual suite.
