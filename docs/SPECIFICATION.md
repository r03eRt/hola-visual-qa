# Visual QA Agent — Product and Technical Specification

## Objective
Build a local-first visual QA system for web pages that runs controlled Playwright scenarios, detects deterministic visual regressions and optionally uses a single external AI API to explain failures.

## MVP
- One or more configured URLs.
- Desktop and mobile Chromium.
- Accepted and rejected consent states.
- Ads enabled/disabled flag.
- Country override through an internal test header or equivalent staging mechanism.
- Full-page baseline screenshots and pixel comparison.
- HTML report, trace, video and diagnostics retained on failure.
- Optional Claude-based explanation of failed evidence.

## Non-goals for MVP
- Production traffic monitoring.
- Autonomous baseline approval.
- Real geo-IP without a proxy or internal override.
- Letting an LLM determine pass/fail.
- Browser-hosted dashboard or database.

## Functional requirements
FR-1 Scenario definitions are data-driven.
FR-2 Every scenario is reproducible locally.
FR-3 Visual comparison is deterministic and performed by Playwright.
FR-4 Dynamic regions are ignored only through explicit selectors.
FR-5 Consent can be set by cookie/storage and optionally verified through UI.
FR-6 Country and ad state use test-only controls.
FR-7 Failures include screenshot, diff, console errors, page errors, failed requests and trace.
FR-8 AI analysis is optional, provider-isolated and disabled by default.
FR-9 The CLI can run all or selected scenarios and update baselines explicitly.
FR-10 No secrets or auth state are committed.

## Quality requirements
- Strict TypeScript.
- One feature per PR.
- Every feature has a SPEC and acceptance criteria.
- Main branch requires CI.
- Snapshot changes require human review.
- Selectors prefer roles/test IDs over fragile CSS.

## Roadmap as independent PRs
1. `feature/project-bootstrap`
2. `feature/scenario-matrix`
3. `feature/consent-fixtures`
4. `feature/page-stabilization`
5. `feature/visual-baselines`
6. `feature/failure-diagnostics`
7. `feature/ad-placement-checks`
8. `feature/country-overrides`
9. `feature/claude-failure-analysis`
10. `feature/json-html-summary`
11. `feature/url-discovery`
12. `feature/local-dashboard`

## Acceptance criteria for initial release
- `npm run test:visual` runs the four default scenarios.
- `npm run test:update` creates explicit baselines.
- A visual difference fails the test and produces an HTML report.
- A JS or network failure is attached to the failed test.
- The project works without an AI key when AI analysis is disabled.
- Enabling Claude requires only `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` and `ENABLE_AI_ANALYSIS=true`.
