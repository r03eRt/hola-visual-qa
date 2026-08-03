# Feature: local-dashboard-shell

## Goal

Build the inert, secure **foundation** of the local dashboard (SPEC-011): a
localhost-bound HTTP server shell composed of a PURE request router (no fs/net)
plus a thin impure `node:http` bootstrap. It serves a self-contained static HTML
shell page and a JSON status endpoint. This PR lays the skeleton only — run
execution (#31) and report viewing (#32) are explicitly out of scope and plug in
later without changing this shell's security posture.

## Context and linked canonical specs

- `docs/specs/SPEC-011-LOCAL-DASHBOARD.md` — localhost by default; reuse core
  orchestration (no duplicate execution logic); no database; must not expose API
  keys or arbitrary filesystem paths; only build once CLI/artifacts/reporting are
  stable.
- `src/reporting/html/escape.ts` / `render.ts` — the established
  self-contained-HTML pattern (no CDN, no `<script>`, all values escaped) to
  mirror for the shell page.
- `src/domain/error.ts` — `normalizeError(...)` used for the configuration error
  on an invalid/unsafe bind.
- `src/orchestrator/*` — deliberately NOT imported: it is a thin prototype whose
  `RunResult` differs from the domain `RunResult`; the shell stays decoupled.

## Non-goals

- No run/plan execution or orchestration wiring (deferred to #31).
- No report reading, artifact serving, or file streaming (deferred to #32).
- No client-side JavaScript, no CDN/external assets, no build step, no database.
- No new runtime dependencies — use Node's built-in `node:http` only.
- No authentication/session/cookies (single-user localhost tool).

## Proposed interfaces and files

All under a new `src/dashboard/` module. Split PURE core from the impure server
bootstrap so the router/config are hermetically unit-testable.

- `src/dashboard/config.ts` (PURE):
  - `DashboardConfigSchema` (Zod, `.strict()`) → `DashboardConfig`
    `{ host: string; port: number; allowNonLoopback: boolean }`.
  - Defaults: `host = '127.0.0.1'`, `port = 4123`, `allowNonLoopback = false`.
    `port` validated as an integer in `1..65535` (0 allowed only for ephemeral
    test binds — accept `0..65535`).
  - `resolveDashboardConfig(input?: unknown): DashboardConfig` — parses/defaults,
    then if the resolved `host` is not a loopback address
    (`127.0.0.1`/`::1`/`localhost`) and `allowNonLoopback` is false, throws a
    normalized `configuration_error` (phase `configuration`) explaining the opt-in.
    Never echoes secrets.
- `src/dashboard/router.ts` (PURE, no fs/net/Date/random):
  - Types `DashboardRequest = { method: string; path: string }` and
    `DashboardResponse = { status: number; contentType: string; body: string }`.
  - `handleDashboardRequest(req: DashboardRequest): DashboardResponse` matching a
    FIXED route allowlist:
    - `GET /` → 200 `text/html; charset=utf-8`, the static shell page.
    - `GET /healthz` → 200 `application/json`, body `{"status":"ok"}`.
    - Unknown path → 404 `application/json`, `{"error":"not_found"}`.
    - Known path, non-GET method → 405 `application/json`,
      `{"error":"method_not_allowed"}`.
  - No path segment is ever used to read the filesystem; unmatched paths are a
    flat 404 (no traversal surface).
- `src/dashboard/shell-page.ts` (PURE): `renderShellPage(): string` — a single
  `<!doctype html>` document with inline `<style>` only, a clear title
  ("Local Visual QA dashboard"), and a visible note that run and report features
  are not yet available. No `<script>`, no `http(s)://` asset, no interpolated
  external data (static string; if any dynamic text is added it must route
  through the reporting `escapeHtml`).
- `src/dashboard/server.ts` (IMPURE, the only non-pure layer):
  - `createDashboardServer(config: DashboardConfig, deps?: { router?: typeof
    handleDashboardRequest }): http.Server` — adapts each `IncomingMessage`
    to a `DashboardRequest` (method + pathname only, query/body ignored) and
    writes the `DashboardResponse`. Does not read the request body or fs.
  - `startDashboard(config: DashboardConfig): Promise<{ url: string; port:
    number; close(): Promise<void> }>` — binds `config.host:config.port`,
    resolves once listening.
- `src/dashboard/index.ts` — barrel re-exporting the above.
- (Optional) `src/dashboard/cli.ts` + `dashboard` npm script (`tsx
  src/dashboard/cli.ts`) that resolves config and calls `startDashboard`,
  printing the bound `url`. No secret output.

## Acceptance criteria

- [x] `resolveDashboardConfig` defaults to `127.0.0.1:4123`,
      `allowNonLoopback: false`; rejects an unknown key (strict) and an
      out-of-range port.
- [x] Requesting a non-loopback host without `allowNonLoopback` throws a
      normalized `configuration_error`; with the opt-in it resolves.
- [x] `handleDashboardRequest` returns the four documented responses (`GET /`
      HTML, `GET /healthz` JSON ok, unknown → 404, known+non-GET → 405) and does
      NO filesystem access.
- [x] The shell page is a self-contained document: contains `<!doctype html>`
      and inline `<style>`, contains NO `<script`, NO `http://`/`https://`, NO
      `src="//`; renders the "not yet available" note.
- [x] No response body ever contains API keys, env values, config internals or
      filesystem paths.
- [x] An integration test starts the real server on `127.0.0.1:0` and confirms
      `GET /healthz` → 200 `{"status":"ok"}` and `GET /` → 200 HTML, then closes
      it cleanly.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit`,
      `npm run test:integration` green.

## Test plan

- `tests/unit/dashboard-config.spec.ts` (hermetic) — defaults, strict unknown
  key, port range, loopback vs non-loopback opt-in error.
- `tests/unit/dashboard-router.spec.ts` (hermetic) — the four routes; asserts the
  HTML shell is self-contained (no `<script>`/external URL) and that no response
  leaks secret-shaped/path content; router performs no fs access.
- `tests/integration/dashboard-server.spec.ts` — real `node:http` server on
  `127.0.0.1:0`; fetch `/healthz` and `/`; assert bound host is loopback; close.
- All unit tests hermetic (no net/fs); placeholders only.

## Security/privacy impact

`type:security`. Surfaces reviewed: (1) network binding — loopback-only by
default with explicit opt-in guarded by a normalized error; (2) no filesystem
exposure — the router matches a fixed allowlist and never uses request path to
read files, eliminating path traversal; (3) no secret leakage — responses are
static/status only, never echoing env/config/keys/paths; (4) no client JS /
external assets, mirroring the audited #28 HTML report. A `security-review`
subagent pass runs before merge.

## Baseline impact

None.

## Dependencies and risks

- Depends only on `node:http`, Zod, and `src/domain` `normalizeError`. No new npm
  deps. Deliberately independent of `src/orchestrator` to avoid coupling to an
  unstable `RunResult`.
- Risk: future #31/#32 must preserve these constraints (localhost, no fs
  traversal, no secrets). The fixed-allowlist router makes that regression-safe.

## Handover notes

Execute with Sonnet against this spec. Keep `config.ts`/`router.ts`/
`shell-page.ts` PURE; confine `node:http` to `server.ts`. Reuse the reporting
`escapeHtml` if any dynamic text is rendered. After implementation: independent
review + `security-review` subagent, then update `docs/STATUS.md` (new "Local
dashboard shell" row) and check the boxes.
