# Feature: dashboard-web-api (issue #73)

Backend JSON endpoints so a browser UI (the upcoming React SPA, separate ticket)
can populate a launch form and render runs/reports without scraping HTML.
`type:feature` + `type:security`. No front-end here.

## Context (read first)

- `src/dashboard/server.ts` — the ONLY impure `node:http` layer. `/api/*` is
  read with a 64 KiB body cap then dispatched to `handleApiRequest`; everything
  else goes to `handleReportRequest` (fs, `/runs*`) then the pure static router.
- `src/dashboard/api-router.ts#handleApiRequest(method, path, body, deps: RunControllerDeps)`
  — owns `/api/runs*` (#31). Returns a fixed 404 for unmatched `/api/*`. **Do not
  change its signature or behavior.**
- `src/dashboard/run-controller.ts` — `RunControllerDeps.resolveScenarios(): { config, scenarios: Scenario[] }`.
  The `scenarios` here are exactly the ids `POST /api/runs` accepts.
- `src/dashboard/report-reader.ts` — `ReportReaderDeps` + `listRuns(deps): Promise<RunSummary[]>`
  (newest-first, skips invalid) and `readRun(id, deps): Promise<RunResult | undefined>`
  (unsafe/absent → undefined; all fs paths via `src/artifacts/paths.ts`).
- `src/domain/index.ts` — `Scenario`, `RunSummary`, `RunResult` types.

## New module: `src/dashboard/web-api-router.ts` (PURE async dispatcher)

```ts
export interface WebApiDeps {
  resolveScenarios: () => { scenarios: readonly Scenario[] };
  reader: ReportReaderDeps;
}
export async function handleWebApiRequest(
  method: string, path: string, deps: WebApiDeps
): Promise<DashboardResponse | undefined>;
```

Routes (all `application/json`):
- `GET /api/scenarios` → `200 { scenarios: ScenarioSummary[] }` where
  `ScenarioSummary = { id, page: { path, name? }, device, consent, country, adsEnabled }`
  mapped from `deps.resolveScenarios().scenarios` (explicit mapper — do not leak
  extra fields). Non-GET → `405 {"error":"method_not_allowed"}`.
- `GET /api/reports` → `200 RunSummary[]` from `listRuns(deps.reader)`. Non-GET → 405.
- `GET /api/reports/:id` (regex `^/api/reports/([^/]+)$`) → `readRun(id, deps.reader)`;
  a run → `200` the full `RunResult` JSON; `undefined` → `404 {"error":"not_found"}`.
  Non-GET → 405.
- Any other path → return `undefined` (so the server falls through to
  `handleApiRequest`, keeping `/api/runs*` unchanged).

The dispatcher is pure (no fs/net itself); all disk access is inside the injected
`reader`. `readRun` already maps unsafe/absent ids to `undefined` (→ our 404), so
the `:id` route never leaks a path or throws.

## `src/dashboard/server.ts` (minimal wiring)

- Resolve `webApiDeps: WebApiDeps` ONCE per server: `resolveScenarios` from the
  same source as `runDeps` (reuse `runDeps.resolveScenarios`), `reader` from the
  same `reportDeps.reader` used by #32.
- In the existing `/api/*` `req.on('end')` handler, BEFORE calling
  `handleApiRequest`: `await handleWebApiRequest(method, url.pathname, webApiDeps)`;
  if it returns a response, write it; otherwise fall back to `handleApiRequest`
  exactly as today. A rejection maps to the existing fixed `500 internal_error`.
- No change to the body cap, the static/report dispatch, or any other route.

## Barrel

Export `handleWebApiRequest` + `WebApiDeps` from `src/dashboard/index.ts`.

## Security (`type:security`)

- `GET /api/reports/:id` — id reaches disk only via `report-reader` →
  `paths.ts` (`assertSafeSegment` blocks `..`/separators/absolute); unsafe/absent
  → 404, never a 500 or a leaked path/stack.
- Payloads expose only run/scenario domain data (ids, dimensions, counts,
  timestamps, status, already-redacted error text) — never keys, absolute paths,
  env, or config secrets. `ScenarioSummary` is an explicit allowlist mapper.
- GET-only; no new body parsing. `/`, `/healthz`, `/runs*`, and existing
  `/api/runs*` behavior are unchanged.

## Testing

- `tests/unit/dashboard-web-api.spec.ts` (hermetic, fake `resolveScenarios` +
  fake `reader`): `/api/scenarios` shape + mapping + 405; `/api/reports` list +
  405; `/api/reports/:id` happy + unknown-id 404 + 405; unrelated `/api/x` →
  `undefined` (fallthrough).
- `tests/integration/dashboard-web-api-server.spec.ts` (real temp dir + real
  writers + real `node:http`): persist a run, assert `GET /api/reports` lists it,
  `GET /api/reports/:id` returns the RunResult with matching counts, unknown id →
  404, `GET /api/scenarios` returns a non-empty array whose ids are accepted by a
  subsequent `POST /api/runs`, and `/`, `/healthz`, `GET /api/runs` still work.

## Conventions

ESM/NodeNext, `.js` on all relative imports. Zod v4 `.strict()` if any schema is
added. Tests `import { test, expect } from '@playwright/test'`; unit tests
hermetic (inject fakes, no fs/net); fs-touching tests in `tests/integration/`.
`test:unit` runs 4 projects so totals are 4× unique tests. Run a single
integration file with `--project=desktop-chromium`.

## Acceptance criteria

- [x] `GET /api/scenarios`, `GET /api/reports`, `GET /api/reports/:id` return the
      specified JSON + status codes; unknown report id → 404.
- [x] Scenario ids from `GET /api/scenarios` are exactly those `POST /api/runs` accepts.
- [x] `/`, `/healthz`, `/runs*`, `/api/runs*` unchanged.
- [x] Hermetic unit tests + an integration test over a real temp run dir.
- [x] typecheck, lint, `test:unit`, dashboard integration green; security-review pass.
- [x] `docs/STATUS.md` row added; SPEC boxes checked.

## Out of scope

The React SPA, static asset serving, CSP (next ticket #—). Auth, pagination, filtering.
