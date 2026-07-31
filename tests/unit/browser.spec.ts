import { test, expect } from '@playwright/test';
import { devices, type BrowserContextOptions } from '@playwright/test';
import type { Scenario } from '../../src/domain/index.js';
import type { ProjectConfig } from '../../src/config/schema.js';
import { DEVICE_PROFILES, deviceContextOptions } from '../../src/browser/devices.js';
import { buildContextOptions } from '../../src/browser/context-options.js';
import {
  createScenarioContext,
  newScenarioPage,
  withScenarioContext,
  type BrowserContextLike,
  type BrowserLike
} from '../../src/browser/context-factory.js';

// These MUST equal the `desktop-chromium`/`mobile-chromium` projects in
// playwright.config.ts value-for-value; this is the parity contract the
// whole feature depends on.
const EXPECTED_DESKTOP: BrowserContextOptions = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 900 }
};
const EXPECTED_MOBILE: BrowserContextOptions = { ...devices['Pixel 7'] };

function validScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'home-desktop-accepted-ES-ads',
    page: { path: '/' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true,
    ...overrides
  };
}

function validConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
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
    adapters: { consent: {}, ads: {}, country: {} },
    visual: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
    diagnostics: { captureConsole: true, captureNetwork: true, ignoredDomains: [] },
    artifacts: { outputDir: 'reports', retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none' },
    execution: { retries: 0 },
    ...overrides
  } as ProjectConfig;
}

/** Fake page — only used as an opaque return value from newPage(). */
function fakePage(): unknown {
  return { url: () => 'about:blank' };
}

/** Records every call so tests can assert on exact invocations. */
class FakeBrowserContext implements BrowserContextLike {
  closeCalls = 0;
  newPageCalls = 0;

  async newPage() {
    this.newPageCalls += 1;
    return fakePage() as never;
  }

  async close() {
    this.closeCalls += 1;
  }
}

class FakeBrowser implements BrowserLike {
  newContextCalls: BrowserContextOptions[] = [];
  contexts: FakeBrowserContext[] = [];

  async newContext(options: BrowserContextOptions): Promise<BrowserContextLike> {
    this.newContextCalls.push(options);
    const context = new FakeBrowserContext();
    this.contexts.push(context);
    return context;
  }
}

test.describe('devices', () => {
  test('deviceContextOptions("desktop") matches playwright.config.ts desktop-chromium', () => {
    const options = deviceContextOptions('desktop');
    expect(options).toEqual(EXPECTED_DESKTOP);
    expect(options.viewport).toEqual({ width: 1440, height: 900 });
    expect(options.isMobile).toBeFalsy();
  });

  test('deviceContextOptions("mobile") matches playwright.config.ts mobile-chromium (Pixel 7)', () => {
    const options = deviceContextOptions('mobile');
    expect(options).toEqual(EXPECTED_MOBILE);
    expect(options.isMobile).toBe(true);
    expect(options.hasTouch).toBe(true);
    expect(options.viewport).toEqual(devices['Pixel 7'].viewport);
  });

  test('DEVICE_PROFILES exposes both devices keyed by Scenario["device"]', () => {
    expect(DEVICE_PROFILES.desktop).toEqual(EXPECTED_DESKTOP);
    expect(DEVICE_PROFILES.mobile).toEqual(EXPECTED_MOBILE);
  });
});

test.describe('buildContextOptions', () => {
  test('sets baseURL from config.baseUrl and applies the desktop device profile', () => {
    const options = buildContextOptions(validScenario({ device: 'desktop' }), validConfig());
    expect(options.baseURL).toBe('https://example.com');
    expect(options.viewport).toEqual({ width: 1440, height: 900 });
    expect(options.isMobile).toBeFalsy();
  });

  test('sets baseURL from config.baseUrl and applies the mobile device profile', () => {
    const options = buildContextOptions(
      validScenario({ device: 'mobile' }),
      validConfig({ baseUrl: 'https://mobile.example.com' })
    );
    expect(options.baseURL).toBe('https://mobile.example.com');
    expect(options.isMobile).toBe(true);
    expect(options.hasTouch).toBe(true);
  });

  test('overrides win over the device profile and baseURL', () => {
    const options = buildContextOptions(validScenario({ device: 'desktop' }), validConfig(), {
      baseURL: 'https://override.example.com',
      viewport: { width: 320, height: 480 }
    });
    expect(options.baseURL).toBe('https://override.example.com');
    expect(options.viewport).toEqual({ width: 320, height: 480 });
  });
});

test.describe('createScenarioContext', () => {
  test('calls newContext with exactly the buildContextOptions() output', async () => {
    const browser = new FakeBrowser();
    const scenario = validScenario({ device: 'mobile' });
    const config = validConfig();

    await createScenarioContext(browser, scenario, config);

    expect(browser.newContextCalls).toHaveLength(1);
    expect(browser.newContextCalls[0]).toEqual(buildContextOptions(scenario, config));
  });

  test('passes overrides through to newContext', async () => {
    const browser = new FakeBrowser();
    const scenario = validScenario({ device: 'desktop' });
    const config = validConfig();
    const overrides = { baseURL: 'https://override.example.com' };

    await createScenarioContext(browser, scenario, config, overrides);

    expect(browser.newContextCalls[0]).toEqual(buildContextOptions(scenario, config, overrides));
  });
});

test.describe('newScenarioPage', () => {
  test('creates a context and opens a page in it', async () => {
    const browser = new FakeBrowser();
    const { context, page } = await newScenarioPage(browser, validScenario(), validConfig());

    expect(browser.contexts).toHaveLength(1);
    expect(context).toBe(browser.contexts[0]);
    expect(browser.contexts[0].newPageCalls).toBe(1);
    expect(page).toBeDefined();
  });
});

test.describe('withScenarioContext', () => {
  test('returns fn result and closes the context exactly once on success', async () => {
    const browser = new FakeBrowser();

    const result = await withScenarioContext(browser, validScenario(), validConfig(), async (context) => {
      expect(context).toBe(browser.contexts[0]);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(browser.contexts).toHaveLength(1);
    expect(browser.contexts[0].closeCalls).toBe(1);
  });

  test('closes the context exactly once and propagates the throw when fn throws', async () => {
    const browser = new FakeBrowser();
    const boom = new Error('boom');

    await expect(
      withScenarioContext(browser, validScenario(), validConfig(), async () => {
        throw boom;
      })
    ).rejects.toThrow('boom');

    expect(browser.contexts).toHaveLength(1);
    expect(browser.contexts[0].closeCalls).toBe(1);
  });
});
