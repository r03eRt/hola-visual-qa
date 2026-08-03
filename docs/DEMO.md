# Visual QA demo — how to run an end-to-end run

This guide runs the wired Browser MVP flow against a real URL and produces a
deterministic screenshot comparison plus a run summary.

> **Sandbox limitation.** The local macOS sandbox used for agent development
> cannot spawn Chromium page renderers (the integration smoke test documents the
> same Mach-port sandbox denial). The **real visual run therefore happens in CI
> (the gated `visual` job) or on an unrestricted machine**, never in that
> sandbox. The steps below assume such an environment.

## What is wired

- `loadConfig()` → `planScenarios(config)` → `buildVisualRunPlan(...)` expand the
  committed `visual-qa.config.ts` into per-scenario work items (URL, readiness
  policy, visual targets + baseline names).
- `tests/visual/scenarios.spec.ts` consumes the plan and drives the real
  modules: cookie consent adapter, diagnostics collector, page readiness,
  consent state verification, and `toHaveScreenshot` per target.
- Baselines live in the committed `baselines/{projectName}/{baselineName}.png`
  store (`snapshotPathTemplate` in `playwright.config.ts`).

## Prerequisites

- Node 22 and `npm ci` (clean install from the committed lockfile).
- `npx playwright install --with-deps chromium`.
- A QA base URL. **Never point this at production with real credentials.**

## 1. Choose a QA target

- **Locally:** `export BASE_URL="https://your-qa-target.example"`.
- **In CI:** set the `QA_BASE_URL` repository secret. The `visual` workflow is
  gated behind `workflow_dispatch` and fails fast if the secret is missing.

Optionally narrow the matrix with `VISUAL_SCENARIOS` (comma-separated scenario
IDs). Inspect the plan first without launching a browser:

```bash
npm run plan            # dry-run: prints the ordered scenario plan and counts
```

## 2. Seed baselines the first time (reviewed commit)

A fresh checkout has **no** baseline PNGs, so the first run must record them.
Baselines are evidence and require human review — never auto-approved.

```bash
BASE_URL="$BASE_URL" npm run test:visual -- --update-snapshots
```

This writes `baselines/<projectName>/<baselineName>.png`. **Review each image**,
then commit them in a dedicated, reasoned PR (see `docs/PR_WORKFLOW.md` and
`baselines/README.md`). In CI, run the `visual` workflow via `workflow_dispatch`
on a branch, download the report artifact, review, and commit the baselines.

> For promoting an already-produced `actual.png` into the store with an audited
> reason, use `npm run baseline:update -- --reason "..."` instead of blanket
> `--update-snapshots` (see `docs/features/baseline-update-command/SPEC.md`).

## 3. Run and get pass/fail

With baselines committed, re-run without `--update-snapshots`:

```bash
BASE_URL="$BASE_URL" npm run test:visual
# or drive it through the orchestrator (plans via the new planner):
BASE_URL="$BASE_URL" npm run orchestrate
```

Playwright compares against the committed baselines using
`config.visual.maxDiffPixelRatio`. On a diff the test fails and retains a trace,
`actual.png` and `diff.png`. The `visual` CI job uploads the HTML report as an
artifact.

## 4. Interpret results

- **Pass:** the page matches its reviewed baseline within threshold.
- **Fail:** review the diff; a legitimate visual change requires a **written
  reason and a new reviewed baseline commit** — baselines are never updated
  automatically after a failure.

## Selecting a subset

```bash
export VISUAL_SCENARIOS="home-desktop-accepted-es-ads_on,home-mobile-accepted-es-ads_on"
BASE_URL="$BASE_URL" npm run test:visual
```

## Notes

- Playwright and explicit rules decide pass/fail; no LLM ever does.
- No production credentials, cookies, auth state, traces or screenshots of
  authenticated views should be committed.

## Demonstrated first run (issue #77)

The project ships its **first reviewed baselines** against the stable default
target `https://example.com` (a public, static page — ideal for a deterministic
first baseline). They live at:

- `baselines/desktop-chromium/full-page-chromium-ci-desktop.png` (1440x900)
- `baselines/mobile-chromium/full-page-chromium-ci-mobile.png` (Pixel 7)

Reproduce the green run locally (macOS 13, where `chrome-headless-shell` cannot
be installed, so point Playwright at the cached full Chromium):

```bash
export CHROMIUM_EXECUTABLE_PATH="$HOME/Library/Caches/ms-playwright/chromium-1140/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
# temporarily set launchOptions.executablePath on the two chromium projects in
# playwright.config.ts (LOCAL ONLY — never commit), then:
BASE_URL=https://example.com npx playwright test tests/visual \
  --project=desktop-chromium --project=mobile-chromium
# → 8 passed, 8 skipped (device-mismatched scenarios skip per project)
```

**Masking dynamic zones.** Declare per-project mask selectors in
`visual-qa.config.ts` under `visual.maskSelectors` (default
`['[data-visual-mask]']`); they are applied to every `toHaveScreenshot` so
carousels/ads/clocks never cause flaky diffs. `example.com` is fully static, so
no masks are needed for this first target.

**Scope / follow-up.**
- Only the two **chromium** projects are baselined; `desktop-webkit`/
  `desktop-firefox` need those browsers (uninstallable in this environment) — a
  follow-up must generate and review their baselines.
- The committed PNGs are **local Chromium (darwin)** renders. A linux CI run may
  diff on antialiasing, so the gated `visual` CI job stays gated until linux
  baselines are generated and reviewed there.
- consent/ads scenario variants currently **share one baseline** per device
  (they render identically on `example.com`); a follow-up should partition
  baselines per scenario for sites where consent changes the page.
- The baseline creation is recorded with a written reason in
  `baselines/UPDATE_LOG.jsonl`.

