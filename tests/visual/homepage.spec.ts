import { test, expect } from '@playwright/test';
import { scenarios } from '../../src/scenarios/scenarios.js';
import { collectDiagnostics } from '../../src/diagnostics/collector.js';
import { setConsentCookie, setConsentThroughUi } from '../../src/consent/consent-manager.js';
import { preparePage } from '../../src/stability/prepare-page.js';

const selected = process.env.VISUAL_SCENARIOS?.split(',').filter(Boolean);
const activeScenarios = selected?.length ? scenarios.filter(s => selected.includes(s.id)) : scenarios;

for (const scenario of activeScenarios) {
  test(scenario.id, async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('desktop') !== (scenario.device === 'desktop'), 'Scenario belongs to another device project');
    collectDiagnostics(page, testInfo);
    await setConsentCookie(context, scenario.consent);
    await page.setExtraHTTPHeaders({ 'x-test-country': scenario.country, 'x-test-ads-enabled': String(scenario.adsEnabled) });
    await page.goto(scenario.path, { waitUntil: 'domcontentloaded' });
    await setConsentThroughUi(page, scenario.consent);
    await preparePage(page);
    await expect(page).toHaveScreenshot(`${scenario.id}.png`, {
      fullPage: true,
      mask: [page.locator('[data-visual-mask]')]
    });
  });
}
