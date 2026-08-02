import { test, expect } from '@playwright/test';
import type { Scenario } from '../../src/domain/index.js';
import { ProjectConfigSchema, type ProjectConfig } from '../../src/config/schema.js';
import type { AdStateContextLike, AdStateVerifyPageLike, AdStateVerification } from '../../src/ads/adapter.js';
import {
  InitScriptAdStateAdapter,
  createAdStateAdapter,
  assertAdStateSatisfied,
  AdStateVerificationError
} from '../../src/ads/init-script-adapter.js';

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

/** Fake context — records addInitScript calls; scripts can be replayed against a fake window. */
class FakeAdStateContext implements AdStateContextLike {
  calls: Array<{
    script: (arg: { flagName: string; enabled: boolean }) => void;
    arg: { flagName: string; enabled: boolean };
  }> = [];

  async addInitScript(
    script: (arg: { flagName: string; enabled: boolean }) => void,
    arg: { flagName: string; enabled: boolean }
  ): Promise<void> {
    this.calls.push({ script, arg });
  }
}

/** Fake verify page — returns a scripted value from evaluate(). */
class FakeAdStateVerifyPage implements AdStateVerifyPageLike {
  scriptedValue: unknown = undefined;

  async evaluate<R>(fn: (flagName: string) => R, arg: string): Promise<R> {
    void fn;
    void arg;
    return this.scriptedValue as R;
  }
}

test.describe('InitScriptAdStateAdapter.apply', () => {
  test('installs exactly one init script that sets the hook to true', async () => {
    const context = new FakeAdStateContext();
    const adapter = new InitScriptAdStateAdapter({ enabled: true, flagName: '__ADS_ENABLED__' });

    await adapter.apply(context);

    expect(context.calls).toHaveLength(1);
    expect(context.calls[0].arg).toEqual({ flagName: '__ADS_ENABLED__', enabled: true });

    // Run the recorded script against a fake window to assert the boolean is set.
    const fakeWindow: Record<string, unknown> = {};
    const globalWithWindow = globalThis as unknown as { window?: unknown };
    const previousWindow = globalWithWindow.window;
    globalWithWindow.window = fakeWindow;
    try {
      context.calls[0].script(context.calls[0].arg);
    } finally {
      globalWithWindow.window = previousWindow;
    }
    expect(fakeWindow.__ADS_ENABLED__).toBe(true);
  });

  test('installs exactly one init script that sets the hook to false', async () => {
    const context = new FakeAdStateContext();
    const adapter = new InitScriptAdStateAdapter({ enabled: false, flagName: '__ADS_ENABLED__' });

    await adapter.apply(context);

    expect(context.calls).toHaveLength(1);
    expect(context.calls[0].arg).toEqual({ flagName: '__ADS_ENABLED__', enabled: false });

    const fakeWindow: Record<string, unknown> = {};
    const globalWithWindow = globalThis as unknown as { window?: unknown };
    const previousWindow = globalWithWindow.window;
    globalWithWindow.window = fakeWindow;
    try {
      context.calls[0].script(context.calls[0].arg);
    } finally {
      globalWithWindow.window = previousWindow;
    }
    expect(fakeWindow.__ADS_ENABLED__).toBe(false);
  });
});

test.describe('InitScriptAdStateAdapter.verify', () => {
  test('reports satisfied:true, present:true when the page returns the expected boolean (true)', async () => {
    const page = new FakeAdStateVerifyPage();
    page.scriptedValue = true;
    const adapter = new InitScriptAdStateAdapter({ enabled: true, flagName: '__ADS_ENABLED__' });

    const verification = await adapter.verify(page);

    expect(verification).toEqual({ satisfied: true, present: true, expectedEnabled: true });
  });

  test('reports satisfied:true, present:true when the page returns the expected boolean (false)', async () => {
    const page = new FakeAdStateVerifyPage();
    page.scriptedValue = false;
    const adapter = new InitScriptAdStateAdapter({ enabled: false, flagName: '__ADS_ENABLED__' });

    const verification = await adapter.verify(page);

    expect(verification).toEqual({ satisfied: true, present: true, expectedEnabled: false });
  });

  test('reports satisfied:false on a boolean mismatch', async () => {
    const page = new FakeAdStateVerifyPage();
    page.scriptedValue = false;
    const adapter = new InitScriptAdStateAdapter({ enabled: true, flagName: '__ADS_ENABLED__' });

    const verification = await adapter.verify(page);

    expect(verification).toEqual({ satisfied: false, present: true, expectedEnabled: true });
  });

  test('reports present:false, satisfied:false when the hook is undefined', async () => {
    const page = new FakeAdStateVerifyPage();
    page.scriptedValue = undefined;
    const adapter = new InitScriptAdStateAdapter({ enabled: true, flagName: '__ADS_ENABLED__' });

    const verification = await adapter.verify(page);

    expect(verification).toEqual({ satisfied: false, present: false, expectedEnabled: true });
  });

  test('reports present:false, satisfied:false when the hook is a non-boolean value', async () => {
    const page = new FakeAdStateVerifyPage();
    page.scriptedValue = 'true';
    const adapter = new InitScriptAdStateAdapter({ enabled: true, flagName: '__ADS_ENABLED__' });

    const verification = await adapter.verify(page);

    expect(verification).toEqual({ satisfied: false, present: false, expectedEnabled: true });
  });

  test('never throws even when evaluate returns an unexpected value', async () => {
    const page = new FakeAdStateVerifyPage();
    page.scriptedValue = { unexpected: true };
    const adapter = new InitScriptAdStateAdapter({ enabled: true, flagName: '__ADS_ENABLED__' });

    await expect(adapter.verify(page)).resolves.toEqual({
      satisfied: false,
      present: false,
      expectedEnabled: true
    });
  });
});

test.describe('createAdStateAdapter', () => {
  test('defaults flagName to "__ADS_ENABLED__" when config does not set one', () => {
    const scenario = validScenario({ adsEnabled: true });
    const config = validConfig({ adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'none' } } });

    const adapter = createAdStateAdapter(scenario, config);
    const descriptor = adapter.describeRedacted();

    expect(descriptor.flagName).toBe('__ADS_ENABLED__');
    expect(descriptor.expectedEnabled).toBe(true);
  });

  test('uses config.adapters.ads.flagName override when present', () => {
    const scenario = validScenario({ adsEnabled: false });
    const config = validConfig({ adapters: { consent: {}, ads: { strategy: 'init-script', flagName: 'my_ads_flag' }, country: { strategy: 'none' } } });

    const adapter = createAdStateAdapter(scenario, config);
    const descriptor = adapter.describeRedacted();

    expect(descriptor.flagName).toBe('my_ads_flag');
    expect(descriptor.expectedEnabled).toBe(false);
  });

  test('resolves the scenario adsEnabled state as the expected state to apply', async () => {
    const scenario = validScenario({ adsEnabled: false });
    const config = validConfig();

    const adapter = createAdStateAdapter(scenario, config);
    const context = new FakeAdStateContext();
    await adapter.apply(context);

    expect(context.calls[0].arg.enabled).toBe(false);
  });
});

test.describe('describeRedacted', () => {
  test('returns the report-safe descriptor', () => {
    const adapter = new InitScriptAdStateAdapter({ enabled: true, flagName: '__ADS_ENABLED__' });

    expect(adapter.describeRedacted()).toEqual({
      strategy: 'init-script',
      flagName: '__ADS_ENABLED__',
      expectedEnabled: true
    });
  });
});

test.describe('assertAdStateSatisfied', () => {
  test('throws a normalized state_verification_error naming the flag and expected state when not satisfied (mismatch)', () => {
    const verification: AdStateVerification = { satisfied: false, present: true, expectedEnabled: true };

    let thrown: unknown;
    try {
      assertAdStateSatisfied(verification, { flagName: '__ADS_ENABLED__' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AdStateVerificationError);
    const error = thrown as AdStateVerificationError;
    expect(error.message).toContain('__ADS_ENABLED__');
    expect(error.message).toContain('true');
    expect(error.normalized).toBeDefined();
    expect(error.normalized.category).toBe('state_verification_error');
    expect(error.normalized.phase).toBe('state_verification');
  });

  test('throws a normalized state_verification_error naming the flag and expected state when the hook is absent', () => {
    const verification: AdStateVerification = { satisfied: false, present: false, expectedEnabled: false };

    let thrown: unknown;
    try {
      assertAdStateSatisfied(verification, { flagName: 'custom_flag' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AdStateVerificationError);
    const error = thrown as AdStateVerificationError;
    expect(error.message).toContain('custom_flag');
    expect(error.message).toContain('false');
    expect(error.normalized.category).toBe('state_verification_error');
    expect(error.normalized.phase).toBe('state_verification');
  });

  test('does not throw when satisfied', () => {
    const verification: AdStateVerification = { satisfied: true, present: true, expectedEnabled: true };
    expect(() => assertAdStateSatisfied(verification, { flagName: '__ADS_ENABLED__' })).not.toThrow();
  });
});

test.describe('config schema — adapters.ads', () => {
  test('validates with an empty adapters.ads (defaults applied)', () => {
    const config = {
      schemaVersion: 1 as const,
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
      adapters: { ads: {} }
    };

    const result = ProjectConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adapters.ads.strategy).toBe('init-script');
      expect(result.data.adapters.ads.flagName).toBeUndefined();
    }
  });

  test('rejects an unknown key under adapters.ads', () => {
    const config = {
      schemaVersion: 1 as const,
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
      adapters: { ads: { bogus: true } }
    };

    const result = ProjectConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });
});
