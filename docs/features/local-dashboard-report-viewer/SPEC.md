# Feature: local-dashboard-report-viewer (#32, issue #69)

Roadmap item 32 (final). A **read-only HTML report viewer** on the local
dashboard: list persisted runs and open any one by run-id, showing the run
summary and per-scenario verdicts. Reuses artifacts persisted by the execution
contract (#65) and the loopback server from #30/#31. `type:feature` +
`type:security`.

## Context (read first)

- `docs/specs/SPEC-011-LOCAL-DASHBOARD.md` — localhost-only, reuse orchestration
  outputs, no DB, never expose keys/paths.
- `docs/architecture/ARTIFACT_MODEL.md` — the on-disk layout
  `<outputDir>/<runId>/{manifest.json,summary.json,scenarios/<id>/result.json}`.
- `src/artifacts/paths.ts` — canonical path builders. `assertSafeSegment`
  already rejects `..`, path separators and absolute paths in a run-id /
  scenario-id. **All disk access for the viewer MUST go through these builders.**
- `src/domain/result.ts` — `parseRunManifest`, `parseRunSummary`,
  `parseScenarioResult`, `parseRunResult` (Zod, strict, secret-key-guarded).
- `src/reporting/html/report-model.ts` — `buildReportModel(run)` /
  `ReportModel` / `ScenarioReportRow` (pure view model).
- `src/reporting/html/escape.ts` — `escapeHtml` / `escapeAttribute`. Every
  interpolated dynamic value MUST be escaped.
- `src/dashboard/{server,router,api-router}.ts` — the existing server: `/api/*`
  → async `handleApiRequest`; everything else → PURE static router (`/`,
  `/healthz`, else 404). The viewer plugs in a THIRD dispatcher for `/runs`.

## User-agreed scope

- List runs and open **any** run by run-id (not just latest / current session).
- Show **summary + per-scenario verdicts** as HTML. **Do NOT serve or embed
  screenshot/diff images** — the report is text/table only.

## Endpoints

- `GET /runs` → `200 text/html`: a table of runs, newest first, each row:
  run-id (link to `/runs/<id>`), startedAt, finishedAt, counts
  (passed/failed/skipped/total), and a pass/fail badge from
  `deterministicFailure`. Empty state when there are no runs.
- `GET /runs/:id` → `200 text/html`: the run report — a summary header (run-id,
  started/finished, counts, deterministic pass/fail badge, tool version/os/
  browser) and a per-scenario table: scenarioId, page path (+ optional name),
  device, consent, country, adsEnabled, status, and — when present — the
  probable error category and message. **No `<img>` / artifact triplets.**
- `GET /runs/:id` for an unknown/malformed/absent run → `404 text/html` with a
  minimal message. **Never** 500, never a filesystem path, never a stack.
- Non-GET on `/runs` or `/runs/:id` → `405`.
- `/`, `/healthz`, and all `/api/*` routes behave EXACTLY as before.

## Design

Mirror the #31 split: a PURE dispatcher + a PURE renderer + an IMPURE reader,
all wired in `server.ts`.

### `src/dashboard/report-reader.ts` (IMPURE, injectable ports)

```ts
export interface ReportReaderDeps {
  outputDir: string;
  readdir?: (dir: string) => Promise<string[]>;         // default: node:fs/promises readdir (names only)
  readFile?: (path: string) => Promise<string>;         // default: node:fs/promises readFile utf8
  statIsDir?: (path: string) => Promise<boolean>;       // default: node:fs/promises stat().isDirectory()
}

export interface RunListEntry { summary: RunSummary; }  // from summary.json

export async function listRuns(deps: ReportReaderDeps): Promise<RunSummary[]>;
export async function readRun(runId: string, deps: ReportReaderDeps): Promise<RunResult | undefined>;
```

- `listRuns`: `readdir(outputDir)`; for each name, resolve `summaryPath` via the
  path builder (skip names that `assertSafeSegment` rejects), read+`parseRunSummary`;
  skip entries whose summary is missing/unreadable/invalid (a partially-written
  run must not break the list). Return sorted by `runId` **descending** (run-ids
  are lex- and time-sortable: `YYYYMMDDTHHmmssZ-<hex>`).
- `readRun`: build paths via `manifestPath`/`summaryPath`/`scenarioResultPath`
  (which call `assertSafeSegment(runId)` — wrap so a thrown "unsafe segment"
  becomes a returned `undefined`, i.e. a 404). Read+parse manifest and summary;
  for each `manifest.scenarioIds`, read+`parseScenarioResult` its result.json;
  assemble `{ runId, startedAt, finishedAt, manifest, results, counts,
  deterministicFailure }` from summary+manifest+results and validate with
  `parseRunResult`. If the run dir or manifest is absent → `undefined` (404).
  Missing individual result.json for a listed scenario → treat the run as
  incomplete: return `undefined` (404) rather than a partial render. Errors from
  the injected ports for a genuinely absent file (ENOENT) map to `undefined`;
  do not leak the error.

### `src/dashboard/report-page.ts` (PURE renderer, no fs/Date/random)

- `renderRunListPage(runs: readonly RunSummary[]): string` — self-contained
  HTML (no CDN, no `<script>`), table of runs, links `href="/runs/<id>"` with
  the id escaped via `escapeAttribute`, counts, pass/fail badge, empty state.
- `renderRunReportPage(model: ReportModel): string` — summary header + the
  per-scenario table described above, built from `buildReportModel(run)`.
  Reuse `escapeHtml`/`escapeAttribute` for EVERY dynamic value. Do NOT render
  artifact images. May share the small style block with the existing report but
  MUST NOT emit `<img>`.
- `render404Page(message: string): string` — minimal escaped HTML.

### `src/dashboard/report-router.ts` (PURE dispatcher)

```ts
export interface ReportRouterDeps { reader: ReportReaderDeps; }
export async function handleReportRequest(
  method: string, path: string, deps: ReportRouterDeps
): Promise<DashboardResponse | undefined>;
```

- Returns `undefined` for any path other than `/runs` and `/runs/:id` so the
  server falls back to the #30 static router (keeps `/`, `/healthz`, 404 intact).
- `/runs`: GET → `listRuns` → `renderRunListPage` (200 html); else 405.
- `/runs/:id` (regex `^/runs/([^/]+)$`): GET → `readRun`; `undefined` →
  `render404Page` (404 html); a run → `buildReportModel` +
  `renderRunReportPage` (200 html); else 405.
- Content-Type `text/html; charset=utf-8` for HTML responses.

### `src/dashboard/server.ts` (IMPURE wiring — minimal edit)

- Resolve `reportDeps: ReportRouterDeps` ONCE per server (default:
  `outputDir` from `loadConfig().artifacts.outputDir`; real fs ports).
  Injectable via `DashboardServerDeps.reportDeps` for tests.
- Dispatch order per request:
  1. `/api/*` → existing body-capped `handleApiRequest` flow (unchanged).
  2. else → `await handleReportRequest(method, path, reportDeps)`; if it returns
     a response, write it; otherwise fall back to the PURE static `router(...)`.
- The `/runs` branch reads NO request body and never uses the raw path for fs
  access (only the captured `:id`, via the path builders).

### Barrel

Export the new public surface from `src/dashboard/index.ts`.

## Security

- **Path traversal** — run-id flows only through `paths.ts` builders;
  `assertSafeSegment` rejects `..`, `/`, `\`, absolute paths → 404. No user
  input ever concatenated into a path outside these builders.
- **No arbitrary file serving** — only the three known JSON files inside a
  validated run dir are read; nothing else, and no bytes are streamed to the
  client (only parsed-then-rendered domain values).
- **No image/artifact serving** — the report embeds no `<img>`; artifact paths
  in the model are ignored by the renderer.
- **Output encoding** — every dynamic value HTML-escaped; no `<script>`, no CDN.
- **No info disclosure** — list/report expose only run-id, timestamps, counts,
  dimensions, status, and already-redacted error category/message. Never keys,
  absolute paths, env, or config secrets. 404 body is a fixed message.
- **Robustness** — malformed/partial run dirs are skipped (list) or 404 (detail),
  not 500. Injected-port ENOENT → `undefined`, not a leaked error.

## Testing

- `tests/unit/dashboard-report-reader.spec.ts` (hermetic, injected ports):
  listRuns sorts desc and skips invalid/missing summaries; readRun reconstructs
  a valid RunResult; unsafe run-id → undefined; missing manifest → undefined;
  missing a listed scenario result → undefined.
- `tests/unit/dashboard-report-page.spec.ts` (pure): list + report render
  expected content; dynamic values escaped (inject a `<script>`/`"` in an id/
  message and assert it is escaped); NO `<img>` in output; 404 page escaped.
- `tests/unit/dashboard-report-router.spec.ts` (pure, fake reader): `/runs`,
  `/runs/:id` happy paths; unknown id → 404; non-GET → 405; unrelated path →
  `undefined` (fallthrough).
- `tests/integration/dashboard-report-server.spec.ts` (real temp dir): write a
  run via the artifacts writers, start the server with a real reader, assert
  `GET /runs` lists it and `GET /runs/:id` renders its verdicts; unknown id →
  404; `/` and `/healthz` still work. Put in `tests/integration/` (touches fs).

## Conventions

- ESM/NodeNext, `.js` on all relative imports. Zod v4, `.strict()`,
  `z.number().int()`. Tests `import { test, expect } from '@playwright/test'`.
  Unit tests hermetic (inject fakes, no fs/net/browser). `test:unit` runs 4
  projects so totals are 4× unique tests.

## Acceptance criteria

- [x] `GET /runs` lists persisted runs newest-first with counts + pass/fail badge.
- [x] `GET /runs/:id` renders summary + per-scenario verdicts, no images.
- [x] Unknown/malformed run-id → 404 (no stack, no path).
- [x] `/`, `/healthz`, `/api/*` unchanged.
- [x] All dynamic output HTML-escaped; no `<script>`, no CDN, no `<img>`.
- [x] Hermetic unit tests + an integration test over a real temp run dir.
- [x] typecheck, lint, `test:unit`, dashboard integration green; security-review pass.
- [x] `docs/STATUS.md` gets a new row; this SPEC's boxes checked.

## Out of scope

Serving screenshot/diff images, live-refresh/websocket, auth, run deletion,
pagination, cross-host access.
