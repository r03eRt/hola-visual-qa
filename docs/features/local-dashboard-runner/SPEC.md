# Feature: local-dashboard-runner

## Goal

Let the local dashboard LAUNCH a visual-QA run asynchronously and report its
status, by wiring the existing `executeRun` (#65, domain `RunResult`) behind
localhost HTTP endpoints on the #30 shell, using an in-memory async job model
(`POST /api/runs` → id; `GET /api/runs/:id` → status; `GET /api/runs` → list).
No duplicate execution logic; the server never accepts arbitrary config/paths.

## Context and linked canonical specs

- `docs/specs/SPEC-011-LOCAL-DASHBOARD.md` — localhost by default; REUSE core
  orchestration (no duplicate execution); no database; never expose API keys or
  arbitrary filesystem paths.
- `src/dashboard/*` (#30) — `DashboardConfig`, the PURE fixed-allowlist
  `handleDashboardRequest`, the shell page, and the `node:http` `server.ts`
  bootstrap this feature extends. Loopback binding + no-secret constraints hold.
- `src/orchestrator/index.ts` (#65) — `executeRun(request, deps?): Promise<RunResult>`,
  `RunRequest`.
- `src/config/load-config.ts` — `loadConfig()`; `src/scenarios/index.ts` —
  `planScenarios(config).scenarios` (server-side scenario source of truth).
- `src/domain/result.ts` — `RunResult` (secret-guarded), `RunCounts`.

## Non-goals

- No report/artifact viewing or run-output file serving (that is #32).
- No cross-restart persistence of jobs (in-memory only; SPEC-011 "no database").
- No auth/multi-user, no run cancellation, no history beyond process lifetime.
- No client-side JS beyond what #32 may add later; this PR is API + minimal shell
  wiring only (the HTML shell may gain a static note/link, still no `<script>`).
- No new runtime dependencies (Node `node:http` + Zod only).

## Proposed interfaces and files (under `src/dashboard/`)

Keep the #30 pure/impure split: a PURE job store + PURE request validation, a
thin async controller that calls the injected `executeRun`, and an async API
router the `node:http` server dispatches to (falling back to the existing pure
static router).

- `src/dashboard/jobs.ts` (PURE, in-memory, deterministic — no fs/net/executeRun):
  `RunJob { id: string; status: 'running'|'completed'|'failed'; startedAt: string;
  finishedAt?: string; scenarioIds: string[]; summary?: { runId: string; counts:
  RunCounts; deterministicFailure: boolean }; error?: string }`. A `JobStore`
  class over a `Map`: `create(id, startedAt, scenarioIds)`, `complete(id, summary,
  finishedAt)`, `fail(id, message, finishedAt)`, `get(id)`, `list()` (newest-first
  or insertion order — deterministic), `hasActiveRun()` (any `status === 'running'`).
  Transitions are guarded (completing/failing a missing or already-settled job is
  a no-op or throws — pick one and test it).
- `src/dashboard/run-controller.ts` (thin async orchestration; side effects only
  via injected deps): `RunControllerDeps { resolveScenarios: () => { config:
  ProjectConfig; scenarios: Scenario[] }; executeRun: typeof executeRun; store:
  JobStore; now: () => Date; generateJobId: (now: Date) => string }`.
  - `startRun(input: { scenarioIds?: string[] }, deps): { status: number; job?:
    RunJob; error?: string }` — validates `scenarioIds` (if given) against the
    server-planned set (unknown/empty-after-filter → 400); single-flight: if
    `store.hasActiveRun()` → 409; else create the job (status running), kick off
    `executeRun({ config, scenarios: selected })` fire-and-forget, and on settle
    call `store.complete(...)` with a compact summary or `store.fail(...)` with a
    `normalizeError`-safe message (NEVER a raw stack/secret). Returns 202 + job.
- `src/dashboard/api-router.ts` (async dispatch for `/api/*` only; returns
  `undefined` for non-API paths so the server falls back to the #30 static
  router): `handleApiRequest(method: string, path: string, body: string | undefined,
  deps): Promise<DashboardResponse | undefined>`.
  - `POST /api/runs` → parse+validate JSON body (`{ scenarioIds?: string[] }`,
    strict Zod; invalid JSON/shape → 400) → `startRun`; map result status.
  - `GET /api/runs` → 200 JSON list of job summaries.
  - `GET /api/runs/:id` → 200 job JSON, or 404 if unknown.
  - Known `/api/runs` path with an unsupported method → 405.
- `src/dashboard/server.ts` (EXTEND the #30 bootstrap): accept injected run deps
  (config/scenarios resolver, `executeRun`, `JobStore`, clock, id-gen) with
  real defaults. For `/api/*` requests, READ the request body with a hard size
  cap (e.g. 64 KiB → 413, destroy the socket) and dispatch to `handleApiRequest`;
  for everything else keep the existing synchronous static router. `startDashboard`
  wires a fresh `JobStore` + `loadConfig`/`planScenarios` resolver by default.
- `src/dashboard/index.ts` — export the new job/controller/api types + fns.
- `src/dashboard/cli.ts` — unchanged behaviour (still prints the bound URL); the
  default server now serves the run API.

## Acceptance criteria

- [x] `JobStore` transitions are correct and deterministic: create→running;
      complete→completed with summary; fail→failed with message; `hasActiveRun`
      reflects any running job; `get`/`list` behave; settling a missing/settled
      job is handled as specified.
- [x] `POST /api/runs` with no body (or `{}`) starts a run over ALL planned
      scenarios and returns `202 { id, status: 'running' }`; with
      `{ scenarioIds: [...] }` it runs only that valid subset.
- [x] Unknown scenario id (or empty selection) → `400`; a second `POST` while a
      run is active → `409`; invalid JSON → `400`; body over the cap → `413`.
- [x] `GET /api/runs/:id` returns the job and reflects the running→completed (and
      running→failed) transition after the injected `executeRun` settles;
      unknown id → `404`; unsupported method on an API route → `405`.
- [x] No response body or job record contains secrets, cookies, auth state,
      absolute filesystem paths or a raw stack trace; failures are
      `normalizeError`-safe; the RunResult summary is secret-guarded.
- [x] The request handler NEVER accepts arbitrary config/baseUrl/outputDir/URL/
      path — only a subset of server-planned scenario ids.
- [x] `GET /` and `GET /healthz` still behave as in #30.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit`,
      `npm run test:integration` green.

## Test plan

- `tests/unit/dashboard-jobs.spec.ts` (hermetic) — every transition + guards,
  `hasActiveRun`, `list`/`get` determinism.
- `tests/unit/dashboard-run-api.spec.ts` (hermetic) — `handleApiRequest` with an
  injected fake `executeRun` (resolves a canned `RunResult`) and a fixed
  clock/id-gen: POST all/subset (202), unknown id (400), single-flight (409),
  invalid JSON (400), GET list, GET by id running→completed, GET unknown (404),
  405; asserts NO secret/path leakage in any body; asserts a failing `executeRun`
  yields a `failed` job with a safe message (inject one that rejects with an
  Error carrying an absolute path + secret-shaped text, assert neither appears).
- `tests/integration/dashboard-runner-server.spec.ts` — real `node:http` server
  on `127.0.0.1:0` with an INJECTED fake `executeRun`; `POST /api/runs` then poll
  `GET /api/runs/:id` until `completed`; assert a body over the cap yields 413.
- All unit tests hermetic (no real spawn/fs/net — inject fakes).

## Security/privacy impact

`type:security`. Surfaces: (1) HTTP-triggered child-process run — the ONLY input
is a scenario-id subset validated against the server-planned set; no config/URL/
path/command is attacker-controllable, so no command or SSRF injection. (2)
Resource exhaustion — single-flight (409) prevents concurrent Playwright
processes; the request body is size-capped (413). (3) Secret/path leakage — job
records/responses carry only secret-guarded `RunResult` summaries and
`normalizeError`-safe failure messages (no stacks, cookies, auth state or
absolute paths). (4) Binding stays loopback-only (inherited from #30). A
`security-review` subagent pass runs before merge.

## Baseline impact

None (a run only updates snapshots when a future explicit option requests it;
this PR does not expose `--update-snapshots` through the API).

## Dependencies and risks

- Depends on #30 (`src/dashboard`), #65 (`executeRun`), `src/config`,
  `src/scenarios`, `src/domain`. No new npm deps.
- Risk: fire-and-forget async run whose failure must never crash the server —
  the controller must catch/settle every rejection into `store.fail`. Covered by
  a rejecting-`executeRun` test.
- Risk: body reading DoS — mitigated by the size cap + socket destroy.

## Handover notes

Execute with Sonnet against this spec. Keep `jobs.ts` PURE and the request
validation deterministic; confine side effects (`executeRun`, body reading) to
the controller/server with injected deps so unit tests use fakes (no real spawn/
fs/net). Reuse #30's static router untouched (API router returns `undefined` for
non-API paths). After implementation: independent review + `security-review`
subagent, then update `docs/STATUS.md` (new "Local dashboard runner" row) and
check the boxes.
