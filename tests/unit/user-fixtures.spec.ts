import { test, expect } from '@playwright/test';
import type { Scenario } from '../../src/domain/index.js';
import { ProjectConfigSchema, type ProjectConfig } from '../../src/config/schema.js';
import type {
  StorageState,
  StorageStateCookie,
  StorageStateLoader,
  StorageStateOrigin,
  UserFixtureContextLike,
  UserFixtureVerification,
  UserFixtureVerifyPageLike
} from '../../src/user/adapter.js';
import {
  StorageStateUserFixtureAdapter,
  UserFixtureConfigError,
  UserFixtureVerificationError,
  assertUserFixtureSatisfied,
  createUserFixtureAdapter
} from '../../src/user/storage-state-adapter.js';

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
    adapters: { consent: {}, ads: { strategy: 'init-script' }, country: {}, user: { fixtures: [] } },
    visual: { maxDiffPixelRatio: 0.01, animations: 'disabled', maskSelectors: ['[data-visual-mask]'] },
    diagnostics: { captureConsole: true, captureNetwork: true, ignoredDomains: [] },
    artifacts: { outputDir: 'reports', retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none' },
    execution: { retries: 0 },
    ...overrides
  } as ProjectConfig;
}

/** Fake context — records addCookies/addInitScript calls. */
class FakeUserFixtureContext implements UserFixtureContextLike {
  cookieCalls: Array<ReadonlyArray<StorageStateCookie>> = [];
  initScriptCalls: Array<{
    script: (arg: { origins: StorageStateOrigin[] }) => void;
    arg: { origins: StorageStateOrigin[] };
  }> = [];

  async addCookies(cookies: ReadonlyArray<StorageStateCookie>): Promise<void> {
    this.cookieCalls.push(cookies);
  }

  async addInitScript(
    script: (arg: { origins: StorageStateOrigin[] }) => void,
    arg: { origins: StorageStateOrigin[] }
  ): Promise<void> {
    this.initScriptCalls.push({ script, arg });
  }
}

/** Fake verify page — returns a scripted value from evaluate(), records the signal name passed in. */
class FakeUserFixtureVerifyPage implements UserFixtureVerifyPageLike {
  scriptedValue: unknown = undefined;
  capturedSignals: string[] = [];

  async evaluate<R>(fn: (signal: string) => R, arg: string): Promise<R> {
    void fn;
    this.capturedSignals.push(arg);
    return this.scriptedValue as R;
  }
}

/** Fake storage-state loader — returns a scripted StorageState and counts load() calls. */
class FakeStorageStateLoader implements StorageStateLoader {
  scriptedState: StorageState = { cookies: [], origins: [] };
  loadCalls: string[] = [];

  async load(ref: string): Promise<StorageState> {
    this.loadCalls.push(ref);
    return this.scriptedState;
  }
}

/** Minimal fake browser `window` used to exercise a recorded init-script seed. */
function fakeWindow(origin: string) {
  const store = new Map<string, string>();
  return {
    location: { origin },
    localStorage: {
      setItem: (name: string, value: string) => {
        store.set(name, value);
      }
    },
    store
  };
}

test.describe('StorageStateUserFixtureAdapter.apply — anonymous', () => {
  test('performs no I/O (no addCookies, no addInitScript, no loader.load)', async () => {
    const context = new FakeUserFixtureContext();
    const loader = new FakeStorageStateLoader();
    const adapter = new StorageStateUserFixtureAdapter({
      strategy: 'anonymous',
      expectedUser: 'anonymous',
      debugSignal: '__QA_USER__',
      loader
    });

    await adapter.apply(context);

    expect(context.cookieCalls).toHaveLength(0);
    expect(context.initScriptCalls).toHaveLength(0);
    expect(loader.loadCalls).toHaveLength(0);
  });
});

test.describe('StorageStateUserFixtureAdapter.apply — storage-state', () => {
  test('loads the ref once and applies cookies exactly once; addInitScript called when origins present', async () => {
    const context = new FakeUserFixtureContext();
    const loader = new FakeStorageStateLoader();
    loader.scriptedState = {
      cookies: [{ name: 'session', value: 'abc', domain: 'example.com', path: '/' }],
      origins: [{ origin: 'https://example.com', localStorage: [{ name: 'k', value: 'v' }] }]
    };

    const adapter = new StorageStateUserFixtureAdapter({
      strategy: 'storage-state',
      expectedUser: 'shopper',
      debugSignal: '__QA_USER__',
      storageStateRef: 'playwright/.auth/shopper.json',
      loader
    });

    await adapter.apply(context);

    expect(loader.loadCalls).toEqual(['playwright/.auth/shopper.json']);
    expect(context.cookieCalls).toEqual([loader.scriptedState.cookies]);
    expect(context.initScriptCalls).toHaveLength(1);
    expect(context.initScriptCalls[0].arg).toEqual({ origins: loader.scriptedState.origins });
  });

  test('does NOT call addInitScript when origins are empty', async () => {
    const context = new FakeUserFixtureContext();
    const loader = new FakeStorageStateLoader();
    loader.scriptedState = {
      cookies: [{ name: 'session', value: 'abc', domain: 'example.com', path: '/' }],
      origins: []
    };

    const adapter = new StorageStateUserFixtureAdapter({
      strategy: 'storage-state',
      expectedUser: 'shopper',
      debugSignal: '__QA_USER__',
      storageStateRef: 'playwright/.auth/shopper.json',
      loader
    });

    await adapter.apply(context);

    expect(context.cookieCalls).toHaveLength(1);
    expect(context.initScriptCalls).toHaveLength(0);
  });

  test('recorded seed script writes localStorage only for the matching origin', async () => {
    const context = new FakeUserFixtureContext();
    const loader = new FakeStorageStateLoader();
    loader.scriptedState = {
      cookies: [],
      origins: [
        { origin: 'https://example.com', localStorage: [{ name: 'token', value: 'tok-1' }] },
        { origin: 'https://other.example.com', localStorage: [{ name: 'other', value: 'nope' }] }
      ]
    };

    const adapter = new StorageStateUserFixtureAdapter({
      strategy: 'storage-state',
      expectedUser: 'shopper',
      debugSignal: '__QA_USER__',
      storageStateRef: 'playwright/.auth/shopper.json',
      loader
    });

    await adapter.apply(context);

    const { script, arg } = context.initScriptCalls[0];

    // The seed references the ambient `window` global (as Playwright will
    // serialize and run it inside the page); simulate that binding here.
    const globalWithWindow = globalThis as unknown as { window?: unknown };
    const previousWindow = globalWithWindow.window;

    const matchingWindow = fakeWindow('https://example.com');
    globalWithWindow.window = matchingWindow;
    script(arg);
    expect(matchingWindow.store.get('token')).toBe('tok-1');
    expect(matchingWindow.store.has('other')).toBe(false);

    const nonMatchingWindow = fakeWindow('https://not-example.com');
    globalWithWindow.window = nonMatchingWindow;
    script(arg);
    expect(nonMatchingWindow.store.size).toBe(0);

    globalWithWindow.window = previousWindow;
  });
});

test.describe('StorageStateUserFixtureAdapter.verify — storage-state', () => {
  function makeAdapter(): StorageStateUserFixtureAdapter {
    return new StorageStateUserFixtureAdapter({
      strategy: 'storage-state',
      expectedUser: 'shopper',
      debugSignal: '__QA_USER__',
      storageStateRef: 'playwright/.auth/shopper.json'
    });
  }

  test('reports satisfied:true on an exact user match', async () => {
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = 'shopper';
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification).toEqual({
      satisfied: true,
      present: true,
      effectiveUser: 'shopper',
      expectedUser: 'shopper',
      strategy: 'storage-state'
    });
  });

  test('reports satisfied:false on a user mismatch', async () => {
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = 'someone-else';
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification).toEqual({
      satisfied: false,
      present: true,
      effectiveUser: 'someone-else',
      expectedUser: 'shopper',
      strategy: 'storage-state'
    });
  });

  test('reports present:false, effectiveUser:null when the signal is undefined', async () => {
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = undefined;
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification).toEqual({
      satisfied: false,
      present: false,
      effectiveUser: null,
      expectedUser: 'shopper',
      strategy: 'storage-state'
    });
  });

  test('reports present:false, effectiveUser:null when the signal is an empty string', async () => {
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = '';
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification.present).toBe(false);
    expect(verification.effectiveUser).toBeNull();
    expect(verification.satisfied).toBe(false);
  });

  test('reports present:false, effectiveUser:null when the signal is a non-string value', async () => {
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = 42;
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);

    expect(verification.present).toBe(false);
    expect(verification.effectiveUser).toBeNull();
    expect(verification.satisfied).toBe(false);
  });

  test('never throws even when evaluate returns an unexpected object', async () => {
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = { unexpected: true };
    const adapter = makeAdapter();

    await expect(adapter.verify(page)).resolves.toEqual({
      satisfied: false,
      present: false,
      effectiveUser: null,
      expectedUser: 'shopper',
      strategy: 'storage-state'
    });
  });
});

test.describe('StorageStateUserFixtureAdapter.verify — anonymous', () => {
  function makeAdapter(): StorageStateUserFixtureAdapter {
    return new StorageStateUserFixtureAdapter({
      strategy: 'anonymous',
      expectedUser: 'anonymous',
      debugSignal: '__QA_USER__'
    });
  }

  test('satisfied:true when the signal is absent', async () => {
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = undefined;
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);
    expect(verification).toEqual({
      satisfied: true,
      present: false,
      effectiveUser: null,
      expectedUser: 'anonymous',
      strategy: 'anonymous'
    });
  });

  test('satisfied:true when the signal is empty', async () => {
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = '';
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);
    expect(verification.satisfied).toBe(true);
    expect(verification.present).toBe(false);
  });

  test('satisfied:false when a user id is present', async () => {
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = 'shopper';
    const adapter = makeAdapter();

    const verification = await adapter.verify(page);
    expect(verification).toEqual({
      satisfied: false,
      present: true,
      effectiveUser: 'shopper',
      expectedUser: 'anonymous',
      strategy: 'anonymous'
    });
  });
});

test.describe('assertUserFixtureSatisfied', () => {
  test('throws a normalized state_verification_error naming the strategy and expected user on mismatch', () => {
    const verification: UserFixtureVerification = {
      satisfied: false,
      present: true,
      effectiveUser: 'someone-else',
      expectedUser: 'shopper',
      strategy: 'storage-state'
    };

    let thrown: unknown;
    try {
      assertUserFixtureSatisfied(verification, { strategy: 'storage-state', expectedUser: 'shopper' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UserFixtureVerificationError);
    const error = thrown as UserFixtureVerificationError;
    expect(error.message).toContain('storage-state');
    expect(error.message).toContain('shopper');
    expect(error.message).not.toContain('someone-else');
    expect(error.normalized.category).toBe('state_verification_error');
    expect(error.normalized.phase).toBe('state_verification');
  });

  test('throws naming strategy/expectedUser when the signal is absent', () => {
    const verification: UserFixtureVerification = {
      satisfied: false,
      present: false,
      effectiveUser: null,
      expectedUser: 'anonymous',
      strategy: 'anonymous'
    };

    let thrown: unknown;
    try {
      assertUserFixtureSatisfied(verification, { strategy: 'anonymous', expectedUser: 'anonymous' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UserFixtureVerificationError);
    const error = thrown as UserFixtureVerificationError;
    expect(error.message).toContain('anonymous');
    expect(error.normalized.category).toBe('state_verification_error');
    expect(error.normalized.phase).toBe('state_verification');
  });

  test('does not throw when satisfied', () => {
    const verification: UserFixtureVerification = {
      satisfied: true,
      present: true,
      effectiveUser: 'shopper',
      expectedUser: 'shopper',
      strategy: 'storage-state'
    };
    expect(() =>
      assertUserFixtureSatisfied(verification, { strategy: 'storage-state', expectedUser: 'shopper' })
    ).not.toThrow();
  });
});

test.describe('createUserFixtureAdapter', () => {
  test('resolves anonymous with expectedUser "anonymous" when scenario.userFixture is undefined', () => {
    const scenario = validScenario({ userFixture: undefined });
    const config = validConfig();
    const loader = new FakeStorageStateLoader();

    const adapter = createUserFixtureAdapter(scenario, config, loader);
    const descriptor = adapter.describeRedacted();

    expect(descriptor).toEqual({ strategy: 'anonymous', expectedUser: 'anonymous', hasAuthState: false });
  });

  test('resolves storage-state for a fixture with a storageStateRef', () => {
    const scenario = validScenario({ userFixture: 'shopper' });
    const config = validConfig({
      adapters: {
        consent: {},
        ads: { strategy: 'init-script' },
        country: { strategy: 'none' },
        user: { fixtures: [{ id: 'shopper', storageStateRef: 'playwright/.auth/shopper.json' }] }
      }
    });
    const loader = new FakeStorageStateLoader();

    const adapter = createUserFixtureAdapter(scenario, config, loader);
    const descriptor = adapter.describeRedacted();

    expect(descriptor).toEqual({ strategy: 'storage-state', expectedUser: 'shopper', hasAuthState: true });
  });

  test('resolves anonymous (named) for a fixture without a storageStateRef', () => {
    const scenario = validScenario({ userFixture: 'guest' });
    const config = validConfig({
      adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'none' }, user: { fixtures: [{ id: 'guest' }] } }
    });
    const loader = new FakeStorageStateLoader();

    const adapter = createUserFixtureAdapter(scenario, config, loader);
    const descriptor = adapter.describeRedacted();

    expect(descriptor).toEqual({ strategy: 'anonymous', expectedUser: 'guest', hasAuthState: false });
  });

  test('throws a normalized configuration_error/planning UserFixtureConfigError for an unknown fixture id', () => {
    const scenario = validScenario({ userFixture: 'unknown-user' });
    const config = validConfig();
    const loader = new FakeStorageStateLoader();

    let thrown: unknown;
    try {
      createUserFixtureAdapter(scenario, config, loader);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UserFixtureConfigError);
    const error = thrown as UserFixtureConfigError;
    expect(error.message).toContain('unknown-user');
    expect(error.normalized.category).toBe('configuration_error');
    expect(error.normalized.phase).toBe('planning');
  });

  test('uses default debugSignal when config does not set one', async () => {
    const scenario = validScenario({ userFixture: undefined });
    const config = validConfig();
    const loader = new FakeStorageStateLoader();

    const adapter = createUserFixtureAdapter(scenario, config, loader);
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = '';

    await adapter.verify(page);

    expect(page.capturedSignals).toEqual(['__QA_USER__']);
  });

  test('uses config-provided debugSignal', async () => {
    const scenario = validScenario({ userFixture: undefined });
    const config = validConfig({
      adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'none' }, user: { debugSignal: '__CUSTOM_USER_SIGNAL__', fixtures: [] } }
    });
    const loader = new FakeStorageStateLoader();

    const adapter = createUserFixtureAdapter(scenario, config, loader);
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = '';

    await adapter.verify(page);

    expect(page.capturedSignals).toEqual(['__CUSTOM_USER_SIGNAL__']);
  });
});

test.describe('describeRedacted', () => {
  test('storage-state strategy has hasAuthState:true', () => {
    const adapter = new StorageStateUserFixtureAdapter({
      strategy: 'storage-state',
      expectedUser: 'shopper',
      debugSignal: '__QA_USER__',
      storageStateRef: 'playwright/.auth/shopper.json'
    });

    expect(adapter.describeRedacted()).toEqual({
      strategy: 'storage-state',
      expectedUser: 'shopper',
      hasAuthState: true
    });
  });

  test('anonymous strategy has hasAuthState:false', () => {
    const adapter = new StorageStateUserFixtureAdapter({
      strategy: 'anonymous',
      expectedUser: 'anonymous',
      debugSignal: '__QA_USER__'
    });

    expect(adapter.describeRedacted()).toEqual({
      strategy: 'anonymous',
      expectedUser: 'anonymous',
      hasAuthState: false
    });
  });
});

test.describe('config schema — adapters.user', () => {
  function baseConfig(userOverrides: Record<string, unknown>) {
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
      adapters: { user: userOverrides }
    };
  }

  test('validates with an empty adapters.user (fixtures default [])', () => {
    const result = ProjectConfigSchema.safeParse(baseConfig({}));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adapters.user.fixtures).toEqual([]);
      expect(result.data.adapters.user.debugSignal).toBeUndefined();
    }
  });

  test('rejects an unknown key under adapters.user', () => {
    const result = ProjectConfigSchema.safeParse(baseConfig({ bogus: true }));
    expect(result.success).toBe(false);
  });

  test('rejects a fixture entry with an unknown key', () => {
    const result = ProjectConfigSchema.safeParse(
      baseConfig({ fixtures: [{ id: 'shopper', bogus: true }] })
    );
    expect(result.success).toBe(false);
  });

  test('rejects a fixture missing id', () => {
    const result = ProjectConfigSchema.safeParse(
      baseConfig({ fixtures: [{ storageStateRef: 'playwright/.auth/shopper.json' }] })
    );
    expect(result.success).toBe(false);
  });
});

test.describe('security — no auth material or ref path is ever exposed', () => {
  const SECRET_COOKIE = 'SECRET-COOKIE-VALUE-zzz';
  const SECRET_TOKEN = 'SECRET-TOKEN-yyy';
  const SECRET_REF = 'playwright/.auth/secret-path-www.json';

  test('describeRedacted and thrown error messages never contain cookie/token values or the ref path', async () => {
    const context = new FakeUserFixtureContext();
    const loader = new FakeStorageStateLoader();
    loader.scriptedState = {
      cookies: [{ name: 'session', value: SECRET_COOKIE, domain: 'example.com', path: '/' }],
      origins: [{ origin: 'https://example.com', localStorage: [{ name: 'authToken', value: SECRET_TOKEN }] }]
    };

    const adapter = new StorageStateUserFixtureAdapter({
      strategy: 'storage-state',
      expectedUser: 'shopper',
      debugSignal: '__QA_USER__',
      storageStateRef: SECRET_REF,
      loader
    });

    await adapter.apply(context);

    const descriptorSerialized = JSON.stringify(adapter.describeRedacted());
    expect(descriptorSerialized).not.toContain(SECRET_COOKIE);
    expect(descriptorSerialized).not.toContain(SECRET_TOKEN);
    expect(descriptorSerialized).not.toContain(SECRET_REF);

    // Force a verification mismatch and inspect the thrown error message.
    const page = new FakeUserFixtureVerifyPage();
    page.scriptedValue = 'someone-else';
    const verification = await adapter.verify(page);

    let thrown: unknown;
    try {
      assertUserFixtureSatisfied(verification, { strategy: 'storage-state', expectedUser: 'shopper' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UserFixtureVerificationError);
    const error = thrown as UserFixtureVerificationError;
    expect(error.message).not.toContain(SECRET_COOKIE);
    expect(error.message).not.toContain(SECRET_TOKEN);
    expect(error.message).not.toContain(SECRET_REF);
  });
});
