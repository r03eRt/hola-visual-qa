# Feature: browser-context-factory

Roadmap item #6 (Browser MVP — the FIRST browser-launching feature).
Tracking issue: #11.

## Goal

A small, deterministic `src/browser/` layer that:

1. launches Chromium with stable, reproducible options, and
2. creates a Playwright `BrowserContext` for a domain `Scenario` +
   `ProjectConfig`, with **device emulation that matches
   `playwright.config.ts` exactly** (desktop `1440x900`, mobile `Pixel 7`) and
   `baseURL` wired from config, and
3. exposes a **disposable lifecycle** helper that ALWAYS closes the context.

This is the foundation the orchestrator will use to run scenarios outside the
Playwright `test` runner. It does NOT navigate, inject consent, stabilize the
page, capture artifacts or orchestrate — those are later features.

## Context and canonical references

- `docs/architecture/MODULE_MAP.md` — `src/browser/` = "Playwright launch/
  context/page factories".
- `docs/specs/SPEC-003-PAGE-STABILITY.md` — determinism principles (this
  feature only owns the context/device layer, not page stabilization).
- `playwright.config.ts` — the EXISTING device projects that the factory MUST
  match value-for-value: `desktop-chromium` = `{ ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 900 } }`; `mobile-chromium` =
  `devices['Pixel 7']`. Baselines depend on these being identical.
- `src/domain/result.ts` — the `Scenario` type (`device: 'desktop'|'mobile'`)
  this consumes (import via `src/domain/index.js`).
- `src/config/schema.ts` — `ProjectConfig.baseUrl` is the context `baseURL`.

## Non-goals

- No navigation, consent injection, stabilization, screenshots, diagnostics,
  retries, or orchestration/run loop.
- Do NOT modify `src/config/*`, `src/domain/*`, `src/scenarios/*`,
  `src/consent/*`, `src/stability/*`, `src/diagnostics/*`, `src/orchestrator/*`,
  `playwright.config.ts`, or `tests/visual/*`. ADDITIVE under new `src/browser/`.
- Do NOT make the `tests/unit` suite launch a real browser (keep it hermetic).

## Proposed interfaces and files (new, under `src/browser/`)

- `src/browser/devices.ts`
  - `DEVICE_PROFILES: Record<'desktop'|'mobile', BrowserContextOptions>` — the
    SINGLE source of truth for device emulation, built from
    `devices['Desktop Chrome']` + `viewport {1440x900}` and `devices['Pixel 7']`
    (import `devices` from `@playwright/test`). Values MUST equal
    `playwright.config.ts`.
  - `deviceContextOptions(device: Scenario['device']): BrowserContextOptions`.
- `src/browser/context-options.ts`
  - `buildContextOptions(scenario, config, overrides?): BrowserContextOptions` —
    merge order: device profile → `{ baseURL: config.baseUrl }` → `overrides`.
    Keep it to device + baseURL only (locale/timezone/consent/reducedMotion are
    other features' concerns). Pure function, fully unit-testable.
- `src/browser/launcher.ts`
  - `launchBrowser(options?): Promise<Browser>` — `chromium.launch({ headless:
    true, args: DETERMINISTIC_ARGS, ...options })`. Export `DETERMINISTIC_ARGS`
    (documented, minimal, e.g. `--disable-dev-shm-usage`,
    `--force-color-profile=srgb`). Keep it small and commented.
- `src/browser/context-factory.ts`
  - Define minimal structural interfaces `BrowserLike` (`newContext(options):
    Promise<BrowserContextLike>`) and `BrowserContextLike` (`newPage():
    Promise<Page>`, `close(): Promise<void>`) so the factory is testable with an
    injected fake browser (NO real launch in unit tests).
  - `createScenarioContext(browser: BrowserLike, scenario, config, overrides?):
    Promise<BrowserContext>` — calls `browser.newContext(buildContextOptions(...))`.
  - `newScenarioPage(browser, scenario, config, overrides?): Promise<{ context;
    page }>`.
  - `withScenarioContext(browser, scenario, config, fn, overrides?):
    Promise<T>` — creates the context, `await fn(context)`, and ALWAYS
    `await context.close()` in a `finally` (even when `fn` throws); returns
    `fn`'s result. This is the primary disposable entry point.
- `src/browser/index.ts` — barrel.

## Acceptance criteria

- [ ] `deviceContextOptions('desktop')` yields viewport `1440x900` and is NOT a
      mobile profile; `'mobile'` yields the Pixel 7 profile (`isMobile: true`,
      `hasTouch: true`, Pixel 7 viewport). Both equal `playwright.config.ts`.
- [ ] `buildContextOptions` sets `baseURL` from `config.baseUrl`, applies the
      correct device profile, and lets `overrides` win on conflict.
- [ ] `createScenarioContext` calls `newContext` with exactly the options from
      `buildContextOptions` (asserted with an injected fake browser).
- [ ] `withScenarioContext` returns `fn`'s value and closes the context EXACTLY
      once, INCLUDING when `fn` throws (assert via fake; the throw propagates).
- [ ] A real-Chromium smoke test proves a desktop and a mobile context each open
      a page whose `viewportSize()` matches the expected device viewport, then
      close cleanly. (Runs in `tests/integration`, not in the `tests/unit`
      hermetic suite.)
- [ ] `npm run typecheck` and `npm run lint` exit 0; `npx playwright test
      tests/unit` passes and launches NO browser; `docs/STATUS.md` browser row
      updated honestly.

## Test plan

- `tests/unit/browser.spec.ts` (Playwright `test` runner as pure/DI unit tests,
  NO real browser — mirror `tests/unit/*.spec.ts` style). Cover device options,
  `buildContextOptions` merge/override, `createScenarioContext` option passing,
  and `withScenarioContext` teardown-on-success and teardown-on-throw using a
  fake `BrowserLike`/`BrowserContextLike` that records calls.
- `tests/integration/browser-smoke.spec.ts` — real `launchBrowser()` +
  `createScenarioContext`/`newScenarioPage`, open `about:blank`, assert
  `page.viewportSize()` per device, then close browser in a `finally`. Run it
  explicitly with `npx playwright test tests/integration` (Chromium is already
  installed in this environment). Do NOT add it to the `tests/unit` path.
- Verify: `npm run typecheck` → 0, `npm run lint` → 0, `npx playwright test
  tests/unit` → all pass (no browser). Run `npx playwright test
  tests/integration` once to prove the smoke test is green. Do NOT run the
  visual suite (needs BASE_URL/baselines).

## Security/privacy impact

None. No navigation to real sites in unit tests; the smoke test uses
`about:blank` only. No credentials, cookies or storage state are set here.

## Baseline impact

None directly, but device emulation MUST match `playwright.config.ts` so future
screenshots via this factory are pixel-consistent with the existing visual
suite. A stability test asserts the desktop/mobile viewports.

## Dependencies and risks

- Depends on #2 (config) and #3 (domain), both merged. Uses `@playwright/test`
  `devices` + `chromium` (already a dependency).
- Risk: device profile drift vs `playwright.config.ts` breaks pixel parity.
  Mitigation: single `DEVICE_PROFILES` source + tests asserting the exact
  viewports; a comment cross-referencing the config.
- Risk: leaking a browser/context on error. Mitigation: `withScenarioContext`
  `finally`-closes; smoke test closes the browser in `finally`.

## Handover notes

Well-scoped for Sonnet 5. Do the DI/pure design FIRST so the unit suite stays
hermetic; write teardown-on-throw and the device-parity tests first
(`skills/superpowers/test-driven-development`), commit frequently, then add the
real-Chromium smoke test and run it once. Run
`skills/superpowers/verification-before-completion` before the PR (`Closes #11`).
Escalate to Opus if matching `playwright.config.ts` requires touching that file
or if a context option must diverge from the existing device projects.
