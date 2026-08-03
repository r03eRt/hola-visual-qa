import { test, expect } from '@playwright/test';
import { devices } from '@playwright/test';
import type { Scenario } from '../../src/domain/index.js';
import type { ProjectConfig } from '../../src/config/schema.js';
import { launchBrowser } from '../../src/browser/launcher.js';
import { newScenarioPage } from '../../src/browser/context-factory.js';

/**
 * Real-Chromium smoke test. Not part of the hermetic `tests/unit` suite —
 * run explicitly with `npx playwright test tests/integration`.
 */

function scenario(device: Scenario['device']): Scenario {
  return {
    id: `home-${device}-accepted-ES-ads`,
    page: { path: '/' },
    device,
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true
  };
}

function config(): ProjectConfig {
  return {
    schemaVersion: 1,
    projectName: 'hola-visual-qa',
    baseUrl: 'https://example.com',
    allowedHosts: ['example.com'],
    pages: [{ path: '/' }],
    dimensions: {
      device: ['desktop', 'mobile'],
      consent: ['accepted', 'rejected'],
      country: ['ES'],
      ads: [true, false]
    },
    adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'none' }, user: { fixtures: [] } },
    visual: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
    diagnostics: { captureConsole: true, captureNetwork: true, ignoredDomains: [] },
    artifacts: { outputDir: 'reports', retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none', timeoutMs: 30_000, maxOutputTokens: 1024, maxAttempts: 2, maxCostUsd: 0.5 },
    execution: { retries: 0 }
  } as ProjectConfig;
}

test.describe('browser smoke (real Chromium)', () => {
  test('desktop scenario opens a page with the desktop-chromium viewport', async () => {
    const browser = await launchBrowser();
    try {
      const { context, page } = await newScenarioPage(browser, scenario('desktop'), config());
      try {
        await page.goto('about:blank');
        expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });

  test('mobile scenario opens a page with the Pixel 7 viewport', async () => {
    const browser = await launchBrowser();
    try {
      const { context, page } = await newScenarioPage(browser, scenario('mobile'), config());
      try {
        await page.goto('about:blank');
        expect(page.viewportSize()).toEqual(devices['Pixel 7'].viewport);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
});
