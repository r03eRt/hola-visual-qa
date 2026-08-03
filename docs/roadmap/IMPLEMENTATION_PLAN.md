# Implementation plan — one PR per item

## Foundation

1. `feature/locked-toolchain` — pin dependencies, lint config and reproducible install.
2. `feature/config-schema` — versioned config and Zod validation.
3. `feature/domain-result-types` — normalized scenario/run/error contracts.
4. `feature/scenario-planner` — expansion, filters and dry-run.
5. `feature/artifact-layout` — run IDs, paths and manifest.

## Browser MVP

6. `feature/browser-context-factory`
7. `feature/consent-cookie-adapter`
8. `feature/consent-state-verification`
9. `feature/page-readiness-policy`
10. `feature/visual-targets`
11. `feature/baseline-update-command`
12. `feature/diagnostics-collector`
13. `feature/run-summary`

## Advertising capabilities

14. `feature/ad-state-adapter`
15. `feature/placement-contract`
16. `feature/placement-container-checks`
17. `feature/placement-request-events`
18. `feature/placement-render-events`
19. `feature/placement-layout-shift`

## Environment coverage

20. `feature/country-adapter`
21. `feature/user-fixtures`
22. `feature/webkit-project`
23. `feature/firefox-project`
24. `feature/url-sitemap-discovery`

## AI and reporting

25. `feature/evidence-redaction`
26. `feature/ai-provider-contract`
27. `feature/anthropic-analysis`
28. `feature/custom-html-report`
29. `feature/failure-grouping`

## Later

Prerequisite (done): `feature/execution-run-contract` (#65) — bridges a real
Playwright run into a domain `RunResult` and persists manifest/summary/result
JSON. This is the CLI/result/artifact contract the note below refers to.

30. `feature/local-dashboard-shell`
31. `feature/local-dashboard-runner`
32. `feature/local-dashboard-report-viewer` (#69) — read-only HTML viewer:
    `GET /runs` lists persisted runs, `GET /runs/:id` renders the run summary and
    per-scenario verdicts. No images served; reconstructs a domain `RunResult`
    from persisted manifest/summary/result JSON via the artifacts path builders.

Do not jump to dashboard work before the CLI/result/artifact contracts are verified.

## Post-roadmap (web UI + verification)

- `feature/dashboard-web-api` (#73) — JSON API (`/api/scenarios`, `/api/reports`, `/api/reports/:id`) for the browser UI.
- `feature/dashboard-web-ui` (#75) — React SPA served at `/app` by a bounded static server with a strict CSP.
- `feature/e2e-visual-baseline` (#77) — config-driven `visual.maskSelectors`, plus the first reviewed baselines against `https://example.com` and a green chromium visual run. Follow-up: webkit/firefox + linux-CI baselines, and per-scenario baseline partitioning.
- `feature/scenario-baseline-partition` (#79) — fold `scenarioId` into `baselineName` so consent/ads variants no longer share a baseline; example.com baselines repartitioned to 8 per-scenario files.
- `feature/ci-baseline-generation` (#81) — manual `update-baselines` workflow that regenerates all-browser baselines on linux and opens a human-reviewed PR (never auto-merged). Unblocks webkit/firefox + linux baselines once `QA_BASE_URL` is set.
- `feature/live-placement-container-checks` (#83) — first live ad check: expose `PlacementDefinition[]` in the config, select page-applicable placements, and assert real container presence/visibility/size in the browser (deterministic, no LLM). No-op when no placements are configured.
