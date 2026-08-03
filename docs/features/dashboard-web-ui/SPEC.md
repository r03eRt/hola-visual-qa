# Feature: dashboard-web-ui

## Goal

Ship the visual interface for the tool: a React + Vite + TypeScript single-page
app that lets a local user (1) list planned scenarios and launch a run,
(2) watch that run's status live, (3) browse past runs, and (4) view a run
report — all by consuming the JSON API added in #73 (`/api/scenarios`,
`/api/runs`, `/api/runs/:id`, `/api/reports`, `/api/reports/:id`).

## Context and linked canonical specs

- `docs/features/dashboard-web-api/SPEC.md` (#73) — the JSON contract the SPA consumes.
- `docs/features/local-dashboard-runner/SPEC.md` (#31) — `POST /api/runs` (202 + jobId) and `GET /api/runs/:id` (job status).
- `docs/features/local-dashboard-report-viewer/SPEC.md` (#32) — the no-script `/runs` viewer this SPA parallels (must stay intact).
- `src/dashboard/server.ts` — the ONLY `node:http` layer; dispatch order is extended here.
- `src/artifacts/paths.ts` — `assertSafeSegment`/`assertInside` traversal guards to mirror in the static server.

## Non-goals

- No authentication (loopback-only local tool).
- No change to the deterministic execution engine or to any existing API/HTML route.
- No removal of the audited no-script pages `/`, `/runs`, `/healthz` — they stay and keep their tests.
- No binary asset serving beyond what a minimal CSS-only SPA emits (js/css/html/svg/ico). No images/fonts imported by the SPA.
- No CI step to build the SPA (build is local; `web/dist` is gitignored and never required by any test).

## Proposed interfaces and files

### 1. React SPA — `web/`
- Own `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts` (isolated from the root toolchain so the deterministic engine's deps are untouched).
- `web/vite.config.ts`: `@vitejs/plugin-react`, **`base: '/app/'`** (so emitted asset URLs are `/app/assets/*`), `build.outDir: 'dist'`.
- `web/index.html` + `web/src/main.tsx` + `web/src/App.tsx` + small components.
- Views (single page, client-side tab/state, no router library needed):
  - **Launch**: `GET /api/scenarios` → checkbox list of scenario ids (show `page.path`, `device`, `consent`, `country`, `adsEnabled`); submit selected ids via `POST /api/runs`; on 202 capture `jobId` and switch to the live view. (If the API accepts a run request without a scenario subset, sending all is acceptable; match the existing `POST /api/runs` body contract — inspect `api-router.ts`/`run-controller.ts` for the exact request shape and honor it.)
  - **Live status**: poll `GET /api/runs/:id` every ~1.5s until terminal; render status + per-scenario progress; when finished, offer a link to the report.
  - **Runs**: `GET /api/reports` → newest-first list (id, status, counts, timestamps); click → report view.
  - **Report**: `GET /api/reports/:id` → render the `RunResult` (per-scenario verdicts, counts). Text/JSON rendering is enough for MVP; do not attempt to load run PNG artifacts.
- All fetches are same-origin relative URLs. No inline `<script>`; rely on Vite's external module output so a strict CSP passes.

### 2. Bounded static-file server — `src/dashboard/static-server.ts`
- Pure async `handleStaticRequest(method, path, deps: StaticServerDeps): Promise<DashboardResponse | undefined>`.
- Returns `undefined` for any path not under `/app` so the server falls through to the report router and the no-script router unchanged.
- Routes:
  - `GET /app` or `/app/` → serve `web/dist/index.html`.
  - `GET /app/<relPath>` → serve `web/dist/<relPath>` (e.g. `assets/index-<hash>.js`).
  - Non-GET on an `/app` path → `405`.
  - Missing file / unsafe path / traversal → `404` (same JSON body shape as elsewhere).
- **Traversal safety**: split the sub-path into segments; reject `.`/`..`/empty/absolute; resolve against `web/dist` and re-verify with an `assertInside`-style check (mirror `src/artifacts/paths.ts`). Never pass the raw request path to `fs` without this.
- **MIME**: explicit extension→type allowlist (`.html`, `.js`/`.mjs`, `.css`, `.svg`, `.json`, `.ico`, `.map`, `.txt`, `.webmanifest`). Unknown extension → `application/octet-stream`. Never sniff.
- **CSP**: every `/app` response carries `Content-Security-Policy: default-src 'self'` (self-hosted assets + same-origin API only). Deliver via a new optional `headers?: Record<string, string>` field on `DashboardResponse`, applied in `server.ts`'s `writeResponse`.
- `StaticServerDeps`: `{ webDistDir: string; readFile?: (p: string) => Promise<string>; fileExists?: (p: string) => Promise<boolean> }` so tests inject a temp dir with fake files (hermetic; no real `web/dist` needed).

### 3. Wiring — `src/dashboard/server.ts`, `src/dashboard/router.ts`, `src/dashboard/shell-page.ts`, `src/dashboard/index.ts`
- Extend `DashboardResponse` (in `router.ts`) with optional `headers?: Record<string, string>`; in `server.ts` `writeResponse`, set those headers after Content-Type. Backward compatible (existing responses omit it).
- In the non-`/api/` branch of `server.ts`, try `handleStaticRequest` BEFORE `handleReportRequest`; if it returns a response, write it; else fall through unchanged. Resolve `staticDeps` ONCE per server (default `webDistDir` = repo `web/dist` resolved from a stable base).
- `shell-page.ts` (the `/` no-script page): add a visible link to `/app` ("Open the visual app"). Do not otherwise change its structure so #30 tests still pass. If a `/` snapshot/exact-HTML test exists, update that test's expectation in the same PR.
- `src/dashboard/index.ts`: `export * from './static-server.js'`.

### 4. Scripts / config
- Root `package.json`: add `"build:web": "npm --prefix web install && npm --prefix web run build"` (or equivalent) — NOT wired into CI or the default `build`.
- `.gitignore`: add `web/dist` and `web/node_modules`.
- `web/package.json` scripts: `dev`, `build` (`tsc && vite build` or just `vite build`), `preview`.

## Acceptance criteria

- [x] `web/` contains a React+Vite+TS app that builds locally (`npm run build:web`) to `web/dist/index.html` + `/app/assets/*` (Vite `base: '/app/'`).
- [x] With `web/dist` present and the dashboard running, `GET /app` serves the SPA HTML with `Content-Security-Policy: default-src 'self'`, and `GET /app/assets/<hashed>.js|.css` serve with correct MIME.
- [x] The SPA can: list scenarios, launch a run (POST /api/runs), show live status by polling `GET /api/runs/:id`, list past runs (GET /api/reports), and view a report (GET /api/reports/:id) — all same-origin.
- [x] `handleStaticRequest` returns `undefined` for non-`/app` paths; `/`, `/runs`, `/runs/:id`, `/healthz`, and all `/api/*` routes behave exactly as before.
- [x] Path traversal on `/app/..%2f...` or `/app/../` style inputs returns 404 and never reads outside `web/dist` (unit-tested).
- [x] `/` no-script page shows a link to `/app`; its existing tests still pass (updated if they assert exact HTML).
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` all pass; new hermetic unit tests for the static server + at least one integration test hitting `/app` over real `node:http` with a temp `web/dist`.

## Test plan

- **Unit** (`tests/unit/dashboard-static-server.spec.ts`, hermetic, injected fake fs): serves index for `/app` and `/app/`; serves an asset with correct MIME + CSP header; 405 on POST to `/app`; 404 on missing file; 404 on `..`/absolute/embedded-separator traversal; returns `undefined` for `/`, `/runs`, `/api/x`.
- **Integration** (`tests/integration/dashboard-static-server-server.spec.ts`, real temp dir + real `node:http`): write a fake `web/dist/index.html` and `web/dist/assets/app.js`; assert `GET /app` 200 HTML + CSP, `GET /app/assets/app.js` 200 JS, `GET /app/nope` 404, and that `GET /healthz` + `GET /runs` still work.
- SPA UI itself is validated by a local build + manual smoke (documented in handover); no browser E2E added.

## Security/privacy impact

`type:security`. New surfaces: (a) a static-file server that maps request paths to disk, and (b) a script-enabled page. Mitigations: traversal guard mirroring `paths.ts` (reject `.`/`..`/absolute/embedded separators, re-verify `assertInside` `web/dist`); `URL.pathname` is not percent-decoded so `%2e`/`%2f` stay literal → guarded to 404; explicit MIME allowlist (no sniffing); `Content-Security-Policy: default-src 'self'` blocks third-party/inline script and exfiltration; SPA calls only same-origin `/api/*`; no secrets/config serialized to the client beyond the already-public `/api/scenarios` allowlist. A `security-review` subagent pass is required before merge.

## Baseline impact

None. No visual baselines are added or changed.

## Dependencies and risks

- Depends on #73 (merged) for the JSON API.
- Risk: Vite emits an inline module/script that violates `default-src 'self'` → verify the built `index.html` has only external `<script type="module" src>`/modulepreload; if an inline snippet appears, either disable it (Vite `build.modulePreload`/`build.polyfillModulePreload` off) or scope CSP precisely — but do NOT weaken to `'unsafe-inline'`.
- Risk: `web/dist` absent in prod/CI → static routes return 404 gracefully (tests inject their own temp dir, so CI stays green without building the SPA).
