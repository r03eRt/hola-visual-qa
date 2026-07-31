import { test, expect } from '@playwright/test';
import type { Scenario } from '../../src/domain/index.js';
import type { ProjectConfig } from '../../src/config/schema.js';
import type { ConsentContextLike, ConsentPageLike, ConsentState } from '../../src/consent/adapter.js';
import {
  CookieConsentAdapter,
  createCookieConsentAdapter,
  assertConsentSatisfied
} from '../../src/consent/cookie-adapter.js';

const RAW_ACCEPTED_VALUE = 'accepted';
const RAW_MISMATCH_VALUE = '__super-secret-consent-value__';

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

/** Fake context — records addCookies calls and returns a scripted cookies() list. */
class FakeConsentContext implements ConsentContextLike {
  addCookiesCalls: Array<
    ReadonlyArray<{ name: string; value: string; domain?: string; path?: string; secure?: boolean; sameSite?: string }>
  > = [];
  scriptedCookies: ReadonlyArray<{ name: string; value: string; domain?: string }> = [];

  async addCookies(
    cookies: ReadonlyArray<{ name: string; value: string; domain?: string; path?: string; secure?: boolean; sameSite?: string }>
  ): Promise<void> {
    this.addCookiesCalls.push(cookies);
  }

  async cookies(): Promise<ReadonlyArray<{ name: string; value: string; domain?: string }>> {
    return this.scriptedCookies;
  }
}

class FakeConsentPage implements ConsentPageLike {
  constructor(private readonly ctx: FakeConsentContext) {}

  context(): ConsentContextLike {
    return this.ctx;
  }
}

test.describe('CookieConsentAdapter.apply', () => {
  test('adds exactly one cookie with the resolved name/domain and legacy shape', async () => {
    const context = new FakeConsentContext();
    const adapter = new CookieConsentAdapter({
      state: 'accepted',
      cookieName: 'consent_status',
      cookieDomain: 'example.com'
    });

    await adapter.apply(context);

    expect(context.addCookiesCalls).toHaveLength(1);
    expect(context.addCookiesCalls[0]).toHaveLength(1);
    expect(context.addCookiesCalls[0][0]).toEqual({
      name: 'consent_status',
      value: 'accepted',
      domain: 'example.com',
      path: '/',
      secure: true,
      sameSite: 'Lax'
    });
  });

  test('maps rejected state to the "rejected" value by default', async () => {
    const context = new FakeConsentContext();
    const adapter = new CookieConsentAdapter({
      state: 'rejected',
      cookieName: 'consent_status',
      cookieDomain: 'example.com'
    });

    await adapter.apply(context);

    expect(context.addCookiesCalls[0][0].value).toBe('rejected');
  });

  test('allows overriding valueForState', async () => {
    const context = new FakeConsentContext();
    const adapter = new CookieConsentAdapter({
      state: 'accepted',
      cookieName: 'consent_status',
      cookieDomain: 'example.com',
      valueForState: (state: ConsentState) => `custom-${state}`
    });

    await adapter.apply(context);

    expect(context.addCookiesCalls[0][0].value).toBe('custom-accepted');
  });
});

test.describe('CookieConsentAdapter.verify', () => {
  test('reports satisfied:true and present:true when the effective cookie matches', async () => {
    const context = new FakeConsentContext();
    context.scriptedCookies = [{ name: 'consent_status', value: 'accepted', domain: 'example.com' }];
    const page = new FakeConsentPage(context);
    const adapter = new CookieConsentAdapter({
      state: 'accepted',
      cookieName: 'consent_status',
      cookieDomain: 'example.com'
    });

    const verification = await adapter.verify(page);

    expect(verification).toEqual({ satisfied: true, present: true, expectedState: 'accepted' });
  });

  test('reports satisfied:false when the cookie value mismatches the requested state', async () => {
    const context = new FakeConsentContext();
    context.scriptedCookies = [{ name: 'consent_status', value: RAW_MISMATCH_VALUE, domain: 'example.com' }];
    const page = new FakeConsentPage(context);
    const adapter = new CookieConsentAdapter({
      state: 'accepted',
      cookieName: 'consent_status',
      cookieDomain: 'example.com'
    });

    const verification = await adapter.verify(page);

    expect(verification).toEqual({ satisfied: false, present: true, expectedState: 'accepted' });
  });

  test('reports present:false and satisfied:false when the cookie is absent', async () => {
    const context = new FakeConsentContext();
    context.scriptedCookies = [];
    const page = new FakeConsentPage(context);
    const adapter = new CookieConsentAdapter({
      state: 'accepted',
      cookieName: 'consent_status',
      cookieDomain: 'example.com'
    });

    const verification = await adapter.verify(page);

    expect(verification).toEqual({ satisfied: false, present: false, expectedState: 'accepted' });
  });

  test('matches cookies by name AND domain when domain is set, ignoring same-name cookies on other domains', async () => {
    const context = new FakeConsentContext();
    context.scriptedCookies = [
      { name: 'consent_status', value: 'accepted', domain: 'other.example.com' },
      { name: 'consent_status', value: 'rejected', domain: 'example.com' }
    ];
    const page = new FakeConsentPage(context);
    const adapter = new CookieConsentAdapter({
      state: 'accepted',
      cookieName: 'consent_status',
      cookieDomain: 'example.com'
    });

    const verification = await adapter.verify(page);

    // Effective cookie for example.com is "rejected" -> mismatch against expected "accepted".
    expect(verification).toEqual({ satisfied: false, present: true, expectedState: 'accepted' });
  });

  test('uses the effective cookie, not the requested state, to determine satisfaction', async () => {
    const context = new FakeConsentContext();
    context.scriptedCookies = [{ name: 'consent_status', value: 'rejected', domain: 'example.com' }];
    const page = new FakeConsentPage(context);
    const adapter = new CookieConsentAdapter({
      state: 'rejected',
      cookieName: 'consent_status',
      cookieDomain: 'example.com'
    });

    const verification = await adapter.verify(page);

    expect(verification).toEqual({ satisfied: true, present: true, expectedState: 'rejected' });
  });
});

test.describe('createCookieConsentAdapter', () => {
  test('defaults cookieName to "consent_status" and cookieDomain to the baseUrl host', () => {
    const scenario = validScenario({ consent: 'accepted' });
    const config = validConfig({ baseUrl: 'https://www.hola.com', adapters: { consent: {}, ads: {}, country: {} } });

    const adapter = createCookieConsentAdapter(scenario, config);
    const descriptor = adapter.describeRedacted();

    expect(descriptor.cookieName).toBe('consent_status');
    expect(descriptor.cookieDomain).toBe('www.hola.com');
    expect(descriptor.expectedState).toBe('accepted');
  });

  test('uses config.adapters.consent.cookieName/cookieDomain overrides when present', () => {
    const scenario = validScenario({ consent: 'rejected' });
    const config = validConfig({
      baseUrl: 'https://www.hola.com',
      adapters: { consent: { cookieName: 'my_consent', cookieDomain: '.hola.com' }, ads: {}, country: {} }
    });

    const adapter = createCookieConsentAdapter(scenario, config);
    const descriptor = adapter.describeRedacted();

    expect(descriptor.cookieName).toBe('my_consent');
    expect(descriptor.cookieDomain).toBe('.hola.com');
    expect(descriptor.expectedState).toBe('rejected');
  });

  test('resolves the scenario consent state as the expected state to apply', async () => {
    const scenario = validScenario({ consent: 'rejected' });
    const config = validConfig();

    const adapter = createCookieConsentAdapter(scenario, config);
    const context = new FakeConsentContext();
    await adapter.apply(context);

    expect(context.addCookiesCalls[0][0].value).toBe('rejected');
  });
});

test.describe('redaction', () => {
  test('describeRedacted() never contains the raw cookie value', () => {
    const adapter = new CookieConsentAdapter({
      state: 'accepted',
      cookieName: 'consent_status',
      cookieDomain: 'example.com',
      valueForState: () => RAW_MISMATCH_VALUE
    });

    const descriptor = adapter.describeRedacted();

    expect(descriptor).toEqual({
      strategy: 'cookie',
      cookieName: 'consent_status',
      cookieDomain: 'example.com',
      expectedState: 'accepted',
      cookieValue: '[redacted]'
    });
    expect(JSON.stringify(descriptor)).not.toContain(RAW_MISMATCH_VALUE);
  });

  test('ConsentVerification never contains the raw cookie value', async () => {
    const context = new FakeConsentContext();
    context.scriptedCookies = [{ name: 'consent_status', value: RAW_MISMATCH_VALUE, domain: 'example.com' }];
    const page = new FakeConsentPage(context);
    const adapter = new CookieConsentAdapter({
      state: 'accepted',
      cookieName: 'consent_status',
      cookieDomain: 'example.com'
    });

    const verification = await adapter.verify(page);

    expect(JSON.stringify(verification)).not.toContain(RAW_MISMATCH_VALUE);
  });

  test('assertConsentSatisfied throws a normalized state_verification_error with a redacted message when not satisfied', () => {
    const verification = { satisfied: false, present: true, expectedState: 'accepted' as ConsentState };

    let thrown: unknown;
    try {
      assertConsentSatisfied(verification, { cookieName: 'consent_status', cookieDomain: 'example.com' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    const error = thrown as Error & { normalized?: { category: string; phase: string } };
    expect(error.message).not.toContain(RAW_MISMATCH_VALUE);
    expect(error.message).not.toContain(RAW_ACCEPTED_VALUE);
    expect(error.message).toContain('consent_status');
    expect(error.message).toContain('example.com');
    expect(error.normalized).toBeDefined();
    expect(error.normalized?.category).toBe('state_verification_error');
    expect(error.normalized?.phase).toBe('state_verification');
  });

  test('assertConsentSatisfied does not throw when satisfied', () => {
    const verification = { satisfied: true, present: true, expectedState: 'accepted' as ConsentState };
    expect(() =>
      assertConsentSatisfied(verification, { cookieName: 'consent_status', cookieDomain: 'example.com' })
    ).not.toThrow();
  });
});
