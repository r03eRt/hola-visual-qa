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

## Configuring ad placement checks (container stage)

Ad placements are checked deterministically in the browser (no LLM). Declare
them under `placements` in `visual-qa.config.ts` — an empty/absent list is a
no-op, so runs without placements are unaffected:

```ts
placements: [
  {
    id: 'top-banner',
    pages: ['/'],                       // matched by page path OR page name
    containerSelector: '#top-ad-slot',
    allowedSizes: [{ width: 970, height: 250 }],
    visibility: { desktop: true, mobile: false }  // optional; defaults true/true
  }
]
```

For every scenario whose page matches `pages`, the run reads the container's
real DOM state and **fails the test** when the container is missing, not
visible, or sized outside `allowedSizes` (within a 1px tolerance) — or, where
`visibility` says it should be hidden, when it is unexpectedly visible. The
failure message names only the placement id and a report-safe reason (e.g.
`Placement "top-banner" container check failed: container missing`); the
selector value and page content are never leaked. Request/render and
layout-shift checks are separate, later slices.

### Request/render stages (page-emitted debug events)

Request/render outcomes are semantic and cannot be read from raw network
traffic, so they arrive as **page-emitted debug events**, not a network
sniffer. When a placement declares `events`, the run installs a bridge that
exposes `window.__qaPlacementEvent` — the QA target (or an injected adapter)
calls it as the ad lifecycle progresses:

```ts
placements: [
  {
    id: 'top-banner',
    pages: ['/'],
    containerSelector: '#top-ad-slot',
    allowedSizes: [{ width: 970, height: 250 }],
    events: { request: 'adreq', render: 'render' }   // signal names
  }
]
```

```js
// In the page (site instrumentation or an injected adapter):
window.__qaPlacementEvent({ placementId: 'top-banner', signal: 'adreq' });
window.__qaPlacementEvent({ placementId: 'top-banner', signal: 'render:rendered' });
// outcomes: render:rendered | render:empty | render:provider_error | render:timeout
```

The run classifies the placement and **fails** on a terminal-unsatisfied state
(`request_missing`, `empty` without `expectedEmpty`, `provider_error`,
`timeout`). If no events arrive the stage stays non-terminal — a pass, since the
model never fabricates a timeout. The bridge hard-normalizes every call to
`{ placementId, signal }` and drops all other fields, so no URL/payload is
captured.

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
- Each scenario has its **own** baseline (partitioned by scenario id since #79),
  so consent/ads variants never share or overwrite one image.
- The baseline creation is recorded with a written reason in
  `baselines/UPDATE_LOG.jsonl`.

## Generating baselines in CI (all browsers)

The local macOS 13 environment cannot install `webkit`/`firefox`, so baselines
for those projects — and platform-correct **linux** chromium baselines — are
produced by the manual **"Update visual baselines"** workflow
(`.github/workflows/update-baselines.yml`), which routes every regeneration
through a human-reviewed PR (it never pushes to `main` and never auto-merges).

1. Set the `QA_BASE_URL` repository secret to a reachable, stable QA target.
2. Actions → **Update visual baselines** → **Run workflow**. Provide a
   **reason** (required); optionally limit `scenarios` (comma-separated ids) or
   `projects` (e.g. `desktop-webkit desktop-firefox`).
3. The workflow installs chromium+webkit+firefox, runs `test:update` against the
   secret target, appends a reasoned line to `baselines/UPDATE_LOG.jsonl`,
   uploads the baselines + HTML report as artifacts, and opens a **draft PR** on
   a `baselines/update-<run-id>` branch.
4. **Review every changed image** in that PR before merging — baselines are
   evidence and are never auto-approved. Once merged, the gated `visual` CI job
   asserts green against them (and can then be promoted to a required check).


