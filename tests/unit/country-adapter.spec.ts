import { test, expect } from '@playwright/test';
import type { Scenario } from '../../src/domain/index.js';
import { ProjectConfigSchema, type ProjectConfig } from '../../src/config/schema.js';
import type { CountryContextLike, CountryVerifyPageLike, CountryVerification } from '../../src/country/adapter.js';
import {
  StrategyCountryAdapter,
  createCountryAdapter,
  assertCountrySatisfied,
  CountryVerificationError
} from '../../src/country/strategy-adapter.js';

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
    visual: { maxDiffPixelRatio: 0.01, animations: 'disabled', maskSelectors: ['[data-visual-mask]'] },
    diagnostics: { captureConsole: true, captureNetwork: true, ignoredDomains: [] },
    artifacts: { outputDir: 'reports', retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none' },
    execution: { retries: 0 },
    ...overrides
  } as ProjectConfig;
}

/** Fake context — records setExtraHTTPHeaders/addCookies calls. */
class FakeCountryContext implements CountryContextLike {
  headerCalls: Array<Record<string, string>> = [];
  cookieCalls: Array<
    ReadonlyArray<{
      name: string;
      value: string;
      domain: string;
      path: string;
      secure: boolean;
      sameSite: 'Lax' | 'Strict' | 'None';
    }>
  > = [];

  async setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
    this.headerCalls.push(headers);
  }

  async addCookies(
    cookies: ReadonlyArray<{
      name: string;
      value: string;
      domain: string;
      path: string;
      secure: boolean;
      sameSite: 'Lax' | 'Strict' | 'None';
    }>
  ): Promise<void> {
    this.cookieCalls.push(cookies);
  }
}

/** Fake verify page — returns a scripted value from evaluate(). */
class FakeCountryVerifyPage implements CountryVerifyPageLike {
  scriptedValue: unknown = undefined;

  async evaluate<R>(fn: (signal: string) => R, arg: string): Promise<R> {
    void fn;
    void arg;
    return this.scriptedValue as R;
  }
}

test.describe('StrategyCountryAdapter.apply', () => {
  test('header strategy sets exactly the extra header and adds no cookie', async () => {
    const context = new FakeCountryContext();
    const adapter = new StrategyCountryAdapter({
      strategy: 'header',
      country: 'ES',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });

    await adapter.apply(context);

    expect(context.headerCalls).toEqual([{ 'X-QA-Country': 'ES' }]);
    expect(context.cookieCalls).toHaveLength(0);
  });

  test('cookie strategy adds exactly one cookie and sets no header', async () => {
    const context = new FakeCountryContext();
    const adapter = new StrategyCountryAdapter({
      strategy: 'cookie',
      country: 'FR',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });

    await adapter.apply(context);

    expect(context.headerCalls).toHaveLength(0);
    expect(context.cookieCalls).toEqual([
      [
        {
          name: 'qa_country',
          value: 'FR',
          domain: 'example.com',
          path: '/',
          secure: true,
          sameSite: 'Lax'
        }
      ]
    ]);
  });

  test('none strategy performs no I/O (neither header nor cookie)', async () => {
    const context = new FakeCountryContext();
    const adapter = new StrategyCountryAdapter({
      strategy: 'none',
      country: 'ES',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });

    await adapter.apply(context);

    expect(context.headerCalls).toHaveLength(0);
    expect(context.cookieCalls).toHaveLength(0);
  });
});

test.describe('StrategyCountryAdapter.verify', () => {
  function makeAdapter(): StrategyCountryAdapter {
    return new StrategyCountryAdapter({
      strategy: 'header',
      country: 'ES',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });
  }

  test('reports satisfied:true, present:true on an exact match', async () => {
    const page = new FakeCountryVerifyPage();
    page.scriptedValue = 'ES';
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification).toEqual({
      satisfied: true,
      present: true,
      effective: 'ES',
      expectedCountry: 'ES',
      strategy: 'header'
    });
  });

  test('reports satisfied:true on a case-insensitive match', async () => {
    const page = new FakeCountryVerifyPage();
    page.scriptedValue = 'es';
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification).toEqual({
      satisfied: true,
      present: true,
      effective: 'es',
      expectedCountry: 'ES',
      strategy: 'header'
    });
  });

  test('reports satisfied:false on a country mismatch', async () => {
    const page = new FakeCountryVerifyPage();
    page.scriptedValue = 'FR';
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification).toEqual({
      satisfied: false,
      present: true,
      effective: 'FR',
      expectedCountry: 'ES',
      strategy: 'header'
    });
  });

  test('reports present:false, effective:null when the signal is undefined', async () => {
    const page = new FakeCountryVerifyPage();
    page.scriptedValue = undefined;
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification).toEqual({
      satisfied: false,
      present: false,
      effective: null,
      expectedCountry: 'ES',
      strategy: 'header'
    });
  });

  test('reports present:false, effective:null when the signal is an empty string', async () => {
    const page = new FakeCountryVerifyPage();
    page.scriptedValue = '';
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification).toEqual({
      satisfied: false,
      present: false,
      effective: null,
      expectedCountry: 'ES',
      strategy: 'header'
    });
  });

  test('reports present:false, effective:null when the signal is a non-string value', async () => {
    const page = new FakeCountryVerifyPage();
    page.scriptedValue = 42;
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification).toEqual({
      satisfied: false,
      present: false,
      effective: null,
      expectedCountry: 'ES',
      strategy: 'header'
    });
  });

  test('never throws even when evaluate returns an unexpected value', async () => {
    const page = new FakeCountryVerifyPage();
    page.scriptedValue = { unexpected: true };
    const adapter = makeAdapter();

    await expect(adapter.verify(page)).resolves.toEqual({
      satisfied: false,
      present: false,
      effective: null,
      expectedCountry: 'ES',
      strategy: 'header'
    });
  });
});

test.describe('createCountryAdapter', () => {
  test('defaults strategy to "none" and header/cookie/debugSignal names when config does not set them', async () => {
    const scenario = validScenario({ country: 'ES' });
    // Parsed through the schema (rather than a raw fixture) so the strategy
    // default ('none') is actually applied, mirroring how a real project
    // config with an empty adapters.country is resolved.
    const parsed = ProjectConfigSchema.parse({
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
      adapters: { consent: {}, ads: { strategy: 'init-script' }, country: {} }
    });
    const config = validConfig(parsed);

    const adapter = createCountryAdapter(scenario, config);
    const descriptor = adapter.describeRedacted();

    expect(descriptor.strategy).toBe('none');
    expect(descriptor.expectedCountry).toBe('ES');
    expect(descriptor.mechanism).toBe('none');
  });

  test('uses config-provided strategy/headerName', async () => {
    const scenario = validScenario({ country: 'FR' });
    const config = validConfig({
      adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'header', headerName: 'X-Custom-Country' }, user: { fixtures: [] } }
    });

    const adapter = createCountryAdapter(scenario, config);
    const context = new FakeCountryContext();
    await adapter.apply(context);

    expect(context.headerCalls).toEqual([{ 'X-Custom-Country': 'FR' }]);
    expect(adapter.describeRedacted().mechanism).toBe('header X-Custom-Country');
  });

  test('uses config-provided strategy/cookieName and cookieDomain', async () => {
    const scenario = validScenario({ country: 'IT' });
    const config = validConfig({
      adapters: {
        consent: {},
        ads: { strategy: 'init-script' },
        country: { strategy: 'cookie', cookieName: 'custom_country', cookieDomain: 'staging.example.com' },
        user: { fixtures: [] }
      }
    });

    const adapter = createCountryAdapter(scenario, config);
    const context = new FakeCountryContext();
    await adapter.apply(context);

    expect(context.cookieCalls).toEqual([
      [
        {
          name: 'custom_country',
          value: 'IT',
          domain: 'staging.example.com',
          path: '/',
          secure: true,
          sameSite: 'Lax'
        }
      ]
    ]);
  });

  test('falls back cookieDomain to the host of config.baseUrl when not set', async () => {
    const scenario = validScenario({ country: 'DE' });
    const config = validConfig({
      baseUrl: 'https://qa.example.org',
      adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'cookie' }, user: { fixtures: [] } }
    });

    const adapter = createCountryAdapter(scenario, config);
    const context = new FakeCountryContext();
    await adapter.apply(context);

    expect(context.cookieCalls[0][0].domain).toBe('qa.example.org');
  });

  test('uses config-provided debugSignal for verify', async () => {
    const scenario = validScenario({ country: 'ES' });
    const config = validConfig({
      adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'header', debugSignal: '__CUSTOM_SIGNAL__' }, user: { fixtures: [] } }
    });

    const adapter = createCountryAdapter(scenario, config);
    const page = new FakeCountryVerifyPage();
    page.scriptedValue = 'ES';

    const capturedSignals: string[] = [];
    const originalEvaluate = page.evaluate.bind(page);
    page.evaluate = async <R>(fn: (signal: string) => R, arg: string): Promise<R> => {
      capturedSignals.push(arg);
      return originalEvaluate(fn, arg);
    };

    await adapter.verify(page);

    expect(capturedSignals).toEqual(['__CUSTOM_SIGNAL__']);
  });

  test('resolves the scenario country as the country to apply', async () => {
    const scenario = validScenario({ country: 'PT' });
    const config = validConfig({ adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'header' }, user: { fixtures: [] } } });

    const adapter = createCountryAdapter(scenario, config);
    const context = new FakeCountryContext();
    await adapter.apply(context);

    expect(context.headerCalls[0]['X-QA-Country']).toBe('PT');
  });
});

test.describe('describeRedacted', () => {
  test('header strategy mechanism shape', () => {
    const adapter = new StrategyCountryAdapter({
      strategy: 'header',
      country: 'ES',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });

    expect(adapter.describeRedacted()).toEqual({
      strategy: 'header',
      expectedCountry: 'ES',
      mechanism: 'header X-QA-Country'
    });
  });

  test('cookie strategy mechanism shape', () => {
    const adapter = new StrategyCountryAdapter({
      strategy: 'cookie',
      country: 'FR',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });

    expect(adapter.describeRedacted()).toEqual({
      strategy: 'cookie',
      expectedCountry: 'FR',
      mechanism: 'cookie qa_country'
    });
  });

  test('none strategy mechanism shape', () => {
    const adapter = new StrategyCountryAdapter({
      strategy: 'none',
      country: 'ES',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });

    expect(adapter.describeRedacted()).toEqual({
      strategy: 'none',
      expectedCountry: 'ES',
      mechanism: 'none'
    });
  });
});

test.describe('assertCountrySatisfied', () => {
  test('throws a normalized state_verification_error naming the strategy and expected country on mismatch', () => {
    const verification: CountryVerification = {
      satisfied: false,
      present: true,
      effective: 'FR',
      expectedCountry: 'ES',
      strategy: 'header'
    };

    let thrown: unknown;
    try {
      assertCountrySatisfied(verification, { strategy: 'header', expectedCountry: 'ES' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CountryVerificationError);
    const error = thrown as CountryVerificationError;
    expect(error.message).toContain('header');
    expect(error.message).toContain('ES');
    expect(error.message).not.toContain('FR');
    expect(error.normalized).toBeDefined();
    expect(error.normalized.category).toBe('state_verification_error');
    expect(error.normalized.phase).toBe('state_verification');
  });

  test('throws a normalized state_verification_error naming the strategy and expected country when the signal is absent', () => {
    const verification: CountryVerification = {
      satisfied: false,
      present: false,
      effective: null,
      expectedCountry: 'ES',
      strategy: 'cookie'
    };

    let thrown: unknown;
    try {
      assertCountrySatisfied(verification, { strategy: 'cookie', expectedCountry: 'ES' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CountryVerificationError);
    const error = thrown as CountryVerificationError;
    expect(error.message).toContain('cookie');
    expect(error.message).toContain('ES');
    expect(error.normalized.category).toBe('state_verification_error');
    expect(error.normalized.phase).toBe('state_verification');
  });

  test('does not throw when satisfied', () => {
    const verification: CountryVerification = {
      satisfied: true,
      present: true,
      effective: 'ES',
      expectedCountry: 'ES',
      strategy: 'header'
    };
    expect(() => assertCountrySatisfied(verification, { strategy: 'header', expectedCountry: 'ES' })).not.toThrow();
  });
});

test.describe('config schema — adapters.country', () => {
  function baseConfig(countryOverrides: Record<string, unknown>) {
    return {
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
      adapters: { country: countryOverrides }
    };
  }

  test('validates with an empty adapters.country (defaults applied)', () => {
    const result = ProjectConfigSchema.safeParse(baseConfig({}));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adapters.country.strategy).toBe('none');
      expect(result.data.adapters.country.headerName).toBeUndefined();
      expect(result.data.adapters.country.cookieName).toBeUndefined();
      expect(result.data.adapters.country.cookieDomain).toBeUndefined();
      expect(result.data.adapters.country.debugSignal).toBeUndefined();
    }
  });

  test('rejects an unknown key under adapters.country', () => {
    const result = ProjectConfigSchema.safeParse(baseConfig({ bogus: true }));

    expect(result.success).toBe(false);
  });

  test('rejects an invalid strategy value', () => {
    const result = ProjectConfigSchema.safeParse(baseConfig({ strategy: 'proxy' }));

    expect(result.success).toBe(false);
  });
});

test.describe('privacy', () => {
  const secretLikePattern = /(authorization|api[-_]?key|password|secret|bearer)/i;

  test('apply produces no auth/cookie-secret/token-like value beyond the country code, header/cookie name', async () => {
    const context = new FakeCountryContext();
    const headerAdapter = new StrategyCountryAdapter({
      strategy: 'header',
      country: 'ES',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });
    await headerAdapter.apply(context);

    const cookieAdapter = new StrategyCountryAdapter({
      strategy: 'cookie',
      country: 'ES',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });
    await cookieAdapter.apply(context);

    const serialized = JSON.stringify({ headerCalls: context.headerCalls, cookieCalls: context.cookieCalls });
    expect(secretLikePattern.test(serialized)).toBe(false);
  });

  test('describeRedacted produces only strategy, country code and mechanism name', () => {
    const adapter = new StrategyCountryAdapter({
      strategy: 'cookie',
      country: 'ES',
      headerName: 'X-QA-Country',
      cookieName: 'qa_country',
      cookieDomain: 'example.com',
      debugSignal: '__QA_COUNTRY__'
    });

    const serialized = JSON.stringify(adapter.describeRedacted());
    expect(secretLikePattern.test(serialized)).toBe(false);
    expect(Object.keys(adapter.describeRedacted())).toEqual(['strategy', 'expectedCountry', 'mechanism']);
  });
});
