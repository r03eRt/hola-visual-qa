# Feature: dashboard-shell-navigation (issue #71)

Correct the local dashboard landing page (`GET /`, `src/dashboard/shell-page.ts`)
so it reflects the now-merged runner (#31) and report viewer (#32) instead of the
stale "not yet available" notice, and give it working navigation. `type:feature`.

## Problem

`renderShellPage()` still emits: "Run execution and report viewing are not yet
available in this dashboard." — false since #31/#32 merged — and offers no link to
the viewer, so `/runs` is undiscoverable from the landing page.

## Change

Rewrite the shell page body (PURE, unchanged constraints: one self-contained
`<!doctype html>`, inline `<style>` only, no `<script>`, no external/CDN assets,
all text via `escapeHtml`; relative links only so no `http://`/`https://` appears):
- Drop the stale notice.
- A short intro describing the dashboard.
- Navigation links: **View reports** → `/runs`, **Health** → `/healthz` (relative hrefs).
- A brief, accurate note that a run is launched by `POST /api/runs` (the page itself
  executes nothing; loopback-only), without exposing any secret/path.

No routing/API/viewer behavior changes; only the `/` HTML body.

## Acceptance criteria

- [x] `GET /` no longer claims run execution / report viewing are unavailable.
- [x] The page contains a relative link to `/runs` (and `/healthz`).
- [x] Page stays self-contained: contains `<style`, no `<script`, no `http://`/`https://`/`src="//"`.
- [x] All text escaped; no secret/path/key in the body.
- [x] `/healthz`, `/api/*`, `/runs*` unchanged.
- [x] `tests/unit/dashboard-router.spec.ts` asserts the `/runs` link and the absence of the
      stale notice, keeping the existing self-contained invariants.
- [x] typecheck, lint, `test:unit` green; `docs/STATUS.md` shell row note updated.

## Out of scope

Any styling overhaul, live status on the landing page, auth, `<script>`-driven UX.
