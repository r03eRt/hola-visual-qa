import { test, expect } from '@playwright/test';
import { loadConfig } from '../../src/config/load-config.js';
import { planScenarios } from '../../src/scenarios/index.js';
import { createCookieConsentAdapter } from '../../src/consent/cookie-adapter.js';
import { verifyConsentState } from '../../src/consent/state-verifier.js';
import { createDiagnosticsCollector } from '../../src/diagnostics/collector.js';
import { preparePage } from '../../src/stability/readiness.js';
import { buildVisualRunPlan } from '../../src/orchestrator/run-plan.js';
import {
  readContainerState,
  evaluateContainer,
  assertContainer,
  toContainerSignals,
  installPlacementEventBridge,
  createPlacementEventsCollector,
  evaluateRequest,
  toRequestSignals,
  evaluateRender,
  toRenderSignals,
  classifyPlacement,
  assertPlacementResolved,
  type PlacementEventsCollector
} from '../../src/placements/index.js';

/**
 * Replaces the retired `tests/visual/homepage.spec.ts` scaffold. Wires the
 * REAL Browser MVP modules (planner, consent adapter/state-verifier,
 * readiness, diagnostics, visual targets) end to end. Config is loaded once
 * via `loadConfig()`; scenarios via `planScenarios(config)`, filtered by
 * `VISUAL_SCENARIOS` (comma list) exactly like the legacy spec.
 */
const config = loadConfig();
const { scenarios } = planScenarios(config);

const selected = process.env.VISUAL_SCENARIOS?.split(',').filter(Boolean);
const activeScenarios =
  selected && selected.length > 0 ? scenarios.filter((scenario) => selected.includes(scenario.id)) : scenarios;

const plan = buildVisualRunPlan({ config, scenarios: activeScenarios });

for (const workItem of plan.workItems) {
  const { scenario } = workItem;

  test(scenario.id, async ({ page, context }, testInfo) => {
    test.skip(
      testInfo.project.name.startsWith('desktop') !== (scenario.device === 'desktop'),
      'Scenario belongs to another device project'
    );

    const adapter = createCookieConsentAdapter(scenario, config);
    await adapter.apply(context);

    // Diagnostics are collected for evidence; nothing here fails the test on
    // its own (visual assertions below remain authoritative).
    createDiagnosticsCollector(page, config.diagnostics);

    // Install the placement event bridge BEFORE navigation, but only when a
    // placement on this page declares request/render debug signals — so the
    // default run (no event-configured placements) is completely unchanged.
    const eventPlacements = workItem.placements.filter(
      (placement) => placement.events?.request !== undefined || placement.events?.render !== undefined
    );
    let placementEvents: PlacementEventsCollector | undefined;
    if (eventPlacements.length > 0) {
      const source = await installPlacementEventBridge(page);
      placementEvents = createPlacementEventsCollector(source);
    }

    await page.setExtraHTTPHeaders({
      'x-test-country': scenario.country,
      'x-test-ads-enabled': String(scenario.adsEnabled)
    });

    await page.goto(workItem.url, { waitUntil: 'domcontentloaded' });

    await preparePage(page, workItem.readiness);

    // The target site is unknown ahead of time, so a missing CMP banner must
    // not spuriously fail the run: verify the combined report but assert
    // only that the cookie signal (the state this adapter actually applied)
    // is satisfied, not `report.satisfied` as a whole (which also requires
    // the banner to be dismissed). The deterministic screenshot below stays
    // the authoritative pass/fail signal.
    const report = await verifyConsentState(page, adapter);
    expect(report.signals.cookie.satisfied).toBe(true);

    // Deterministic ad placement checks (explicit rules, never an LLM). The
    // container stage (presence/visibility/size) is always asserted; when a
    // placement declares request/render debug signals, the request+render
    // stages are classified and the terminal verdict asserted too. A no-op
    // when the config declares no placements, keeping the default run
    // unchanged.
    for (const placement of workItem.placements) {
      const raw = await readContainerState(page, placement);
      const containerObs = evaluateContainer(placement, scenario.device, raw);
      assertContainer(containerObs);

      const hasEventSignals = placement.events?.request !== undefined || placement.events?.render !== undefined;
      if (placementEvents !== undefined && hasEventSignals) {
        const signals = {
          ...toContainerSignals(containerObs),
          ...toRequestSignals(evaluateRequest(placement, placementEvents)),
          ...toRenderSignals(evaluateRender(placement, placementEvents))
        };
        assertPlacementResolved(placement, classifyPlacement(placement.id, signals));
      }
    }

    const mask = workItem.readiness.maskSelectors.map((selector) => page.locator(selector));

    for (const item of workItem.targets) {
      if (item.target.kind === 'component' || item.target.kind === 'ad-placement') {
        await expect(page.locator(item.target.selector)).toHaveScreenshot(`${item.baselineName}.png`, {
          maxDiffPixelRatio: config.visual.maxDiffPixelRatio,
          animations: config.visual.animations,
          mask
        });
        continue;
      }

      await expect(page).toHaveScreenshot(`${item.baselineName}.png`, {
        fullPage: item.target.kind === 'full-page',
        maxDiffPixelRatio: config.visual.maxDiffPixelRatio,
        animations: config.visual.animations,
        mask
      });
    }
  });
}
