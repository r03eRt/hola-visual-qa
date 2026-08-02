# Feature SPEC — webkit-project (#47)

Ticket: #47 · Branch: `feature/webkit-project` · Roadmap: Environment coverage (item 22)
Canonical: `docs/specs/SPEC-004-VISUAL-ENGINE.md` ("Baselines are partitioned by
browser/platform policy to avoid accidental cross-platform comparison").

## Goal
Add a single `desktop-webkit` Playwright project (Desktop Safari, viewport
1440x900 to match `desktop-chromium`) so the visual suite can run under the
WebKit engine with its own baseline partition. The visual-targets
`baselineName()` already supports a `webkit` browser partition, so no baseline
logic changes. Minimal cross-browser slice; scenario IDs and existing chromium
baselines are unchanged.

## Scope
- `playwright.config.ts` — add the `desktop-webkit` project after the two
  chromium projects:
  ```ts
  {
    name: 'desktop-webkit',
    use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } }
  }
  ```
- `.github/workflows/ci.yml` — in the gated `visual` job, install `webkit`
  alongside `chromium` (`npx playwright install --with-deps chromium webkit`).
  This is the ONLY job that launches a project browser. The `unit` (hermetic)
  and `browser-integration` (uses `launchBrowser()` = chromium explicitly) jobs
  never launch the project browser, so they need no webkit binary even though the
  project now exists.
- `src/baseline/cli.ts` + `src/baseline/plan.ts` — extend the `--project` union
  (`Project` type and `UpdateRequest.project`) to include `'desktop-webkit'`, and
  update the CLI validation + help text accordingly.
- `tests/unit/webkit-project.spec.ts` — a hermetic test that imports the default
  export of `playwright.config.ts` and asserts the `desktop-webkit` project
  exists, resolves to the WebKit engine (`devices['Desktop Safari']
  .defaultBrowserType === 'webkit'`) and uses the 1440x900 viewport. Launches
  nothing.
- `docs/STATUS.md` — one honest row.

## Non-goals
- `mobile-webkit`/iOS Safari and Firefox (item 23).
- Planner/scenario-ID changes; committing any WebKit baseline PNG; wiring the
  gated visual job into required checks.
- Any change to `src/browser/devices.ts` (the DI factory remains chromium-device
  focused; the WebKit project is a Playwright-runner concern only).

## Acceptance criteria
- [ ] `playwright.config.ts` exports a project named `desktop-webkit` using
      `devices['Desktop Safari']` with `viewport: { width: 1440, height: 900 }`,
      and the two chromium projects are unchanged.
- [ ] The gated CI `visual` job installs both `chromium` and `webkit`; the
      `unit` and `browser-integration` jobs are unchanged.
- [ ] `npm run baseline:update --project desktop-webkit ...` is accepted; an
      invalid `--project` still fails with a usage error naming all three valid
      projects.
- [ ] A hermetic unit test asserts the `desktop-webkit` project's presence,
      WebKit engine and viewport, launching no browser.
- [ ] `npm run typecheck`, `npm run lint`, `npm run test:unit` all exit 0.

## Test plan
`tests/unit/webkit-project.spec.ts` (hermetic): import the config default export,
find the `desktop-webkit` project, assert its `use.viewport` is 1440x900 and that
`devices['Desktop Safari'].defaultBrowserType === 'webkit'` (documenting the
engine), and assert the existing `desktop-chromium`/`mobile-chromium` projects are
still present. Optionally assert the baseline CLI accepts `desktop-webkit` (via
the plan/validation layer) — but keep it light; the CLI already has coverage.

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- Do NOT run the visual suite (needs a QA target + WebKit baselines, gated in CI).

## Security/privacy impact
None. No secrets, no network, no auth. Only a browser project and CI install line.

## Baseline impact
Additive only: a new `webkit` baseline partition becomes possible, but no baseline
image is created or committed here. Existing chromium baselines are untouched
(different partition names).

## Dependencies and risks
- Depends on `@playwright/test` already bundling WebKit (it does). The WebKit
  binary is installed only in the gated visual job.
- Risk: running the visual suite under WebKit will need reviewed WebKit baselines;
  that is deferred to when a QA target and baselines land (see `docs/DEMO.md`).

## Handover notes
Firefox is item 23 (`feature/firefox-project`) and follows the same shape. The
DI browser factory (`src/browser/`) stays chromium-focused; extending it to launch
WebKit/Firefox is a separate concern if/when the orchestrator drives non-chromium
runs.
