# Feature SPEC — firefox-project (#49)

Ticket: #49 · Branch: `feature/firefox-project` · Roadmap: Environment coverage (item 23)
Canonical: `docs/specs/SPEC-004-VISUAL-ENGINE.md`. Mirrors item 22
(`feature/webkit-project`, #47/#48) exactly.

## Goal
Add a single `desktop-firefox` Playwright project (Desktop Firefox, viewport
1440x900 to match `desktop-chromium`) so the visual suite can run under the
Gecko/Firefox engine with its own `firefox` baseline partition. The
visual-targets `baselineName()` already supports a `firefox` partition, so no
baseline logic changes. Minimal cross-browser slice; scenario IDs and existing
chromium/webkit baselines are unchanged.

## Scope
- `playwright.config.ts` — add the `desktop-firefox` project after `desktop-webkit`:
  ```ts
  {
    name: 'desktop-firefox',
    use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } }
  }
  ```
- `.github/workflows/ci.yml` — in the gated `visual` job, install `firefox`
  alongside `chromium webkit` (`npx playwright install --with-deps chromium
  webkit firefox`). This is the ONLY job that launches a project browser; the
  hermetic `unit` and chromium-only `browser-integration` jobs never launch the
  project browser, so they need no Firefox binary.
- `src/baseline/cli.ts` + `src/baseline/plan.ts` — extend the `--project` union
  (`Project` type and `UpdateRequest.project`) to include `'desktop-firefox'`,
  updating the CLI validation + help text.
- `tests/unit/firefox-project.spec.ts` — a hermetic test importing the default
  export of `playwright.config.ts`, asserting the `desktop-firefox` project
  exists, resolves to the Firefox engine (`devices['Desktop Firefox']
  .defaultBrowserType === 'firefox'`) and uses the 1440x900 viewport. Launches
  nothing.
- `docs/STATUS.md` — one honest row.

## Non-goals
- Mobile Firefox (Playwright has no Gecko mobile device); planner/scenario-ID
  changes; committing any Firefox baseline PNG; wiring the gated visual job into
  required checks; changes to `src/browser/devices.ts` (the DI factory stays
  chromium-focused).

## Acceptance criteria
- [ ] `playwright.config.ts` exports a project named `desktop-firefox` using
      `devices['Desktop Firefox']` with `viewport: { width: 1440, height: 900 }`;
      the chromium and webkit projects are unchanged.
- [ ] The gated CI `visual` job installs `chromium webkit firefox`; the `unit`
      and `browser-integration` jobs are unchanged.
- [ ] `npm run baseline:update --project desktop-firefox ...` is accepted; an
      invalid `--project` still fails with a usage error naming all four valid
      projects.
- [ ] A hermetic unit test asserts the `desktop-firefox` project's presence,
      Firefox engine and viewport, launching no browser.
- [ ] `npm run typecheck`, `npm run lint`, `npm run test:unit` all exit 0.

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- Do NOT run the visual suite (needs a QA target + Firefox baselines, gated in CI).

## Security/privacy impact
None. No secrets, no network, no auth. Only a browser project and a CI install line.

## Baseline impact
Additive only: a new `firefox` baseline partition becomes possible; no baseline
image is created or committed here. Existing chromium/webkit baselines are
untouched (different partition names).

## Dependencies and risks
- `@playwright/test` already bundles Firefox; the binary is installed only in the
  gated visual job.
- Risk: a real WebKit/Firefox visual run needs reviewed baselines; deferred to
  when a QA target and baselines land.

## Handover notes
This completes the cross-browser project trio (chromium/webkit/firefox). Extending
the DI browser factory (`src/browser/`) to launch non-chromium engines remains a
separate concern if/when the orchestrator drives non-chromium runs.
