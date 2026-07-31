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

30. `feature/local-dashboard-shell`
31. `feature/local-dashboard-runner`
32. `feature-local-dashboard-report-viewer`

Do not jump to dashboard work before the CLI/result/artifact contracts are verified.
