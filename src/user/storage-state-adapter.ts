import type { ProjectConfig } from '../config/schema.js';
import type { Scenario } from '../domain/index.js';
import { normalizeError, type NormalizedError } from '../domain/error.js';
import type {
  RedactedUserFixtureDescriptor,
  StorageStateLoader,
  StorageStateOrigin,
  UserFixtureAdapter,
  UserFixtureContextLike,
  UserFixtureId,
  UserFixtureStrategy,
  UserFixtureVerification,
  UserFixtureVerifyPageLike
} from './adapter.js';

const DEFAULT_DEBUG_SIGNAL = '__QA_USER__';

export interface StorageStateUserFixtureAdapterOptions {
  strategy: UserFixtureStrategy;
  expectedUser: UserFixtureId | 'anonymous';
  debugSignal: string;
  /** Gitignored reference to a Playwright storageState JSON. Only used (and never
   * exposed) when `strategy === 'storage-state'`. */
  storageStateRef?: string;
  /** DI port that resolves the storage state; never invoked for 'anonymous'. */
  loader?: StorageStateLoader;
}

/**
 * Strategy-based user-fixture adapter. Applies the requested user state via
 * an injected `StorageStateLoader` (`storage-state`) or performs no override
 * (`anonymous`) before any navigation, and verifies the EFFECTIVE user by
 * reading a platform-provided debug signal back — never assumes it matches
 * what was applied.
 */
export class StorageStateUserFixtureAdapter implements UserFixtureAdapter {
  private readonly strategy: UserFixtureStrategy;
  private readonly expectedUser: UserFixtureId | 'anonymous';
  private readonly debugSignal: string;
  private readonly storageStateRef?: string;
  private readonly loader?: StorageStateLoader;

  constructor(options: StorageStateUserFixtureAdapterOptions) {
    this.strategy = options.strategy;
    this.expectedUser = options.expectedUser;
    this.debugSignal = options.debugSignal;
    this.storageStateRef = options.storageStateRef;
    this.loader = options.loader;
  }

  async apply(context: UserFixtureContextLike): Promise<void> {
    if (this.strategy === 'anonymous') {
      // no-op: the scenario runs logged out, at its local user state.
      return;
    }

    if (!this.loader || !this.storageStateRef) {
      // Defensive: createUserFixtureAdapter never builds a 'storage-state'
      // instance without both a ref and a loader.
      return;
    }

    const state = await this.loader.load(this.storageStateRef);
    await context.addCookies(state.cookies);

    if (state.origins.length > 0) {
      await context.addInitScript(seedLocalStorage, { origins: state.origins });
    }
  }

  async verify(page: UserFixtureVerifyPageLike): Promise<UserFixtureVerification> {
    const value = await page.evaluate(
      (name) => (window as unknown as Record<string, unknown>)[name],
      this.debugSignal
    );

    const effectiveUser = typeof value === 'string' && value.length > 0 ? value : null;
    const present = effectiveUser !== null;
    const satisfied =
      this.strategy === 'storage-state' ? present && effectiveUser === this.expectedUser : !present;

    return {
      satisfied,
      present,
      effectiveUser,
      expectedUser: this.expectedUser,
      strategy: this.strategy
    };
  }

  describeRedacted(): RedactedUserFixtureDescriptor {
    return {
      strategy: this.strategy,
      expectedUser: this.expectedUser,
      hasAuthState: this.strategy === 'storage-state'
    };
  }
}

/**
 * Init-script seed run inside the browser (serialized by Playwright): writes
 * each origin's localStorage entries only when the current page origin
 * matches. Must reference only its own argument and browser globals — no
 * outer-scope variables survive serialization.
 */
function seedLocalStorage(arg: { origins: StorageStateOrigin[] }): void {
  for (const o of arg.origins) {
    if (window.location.origin === o.origin) {
      for (const item of o.localStorage) {
        window.localStorage.setItem(item.name, item.value);
      }
    }
  }
}

/**
 * Resolves a `StorageStateUserFixtureAdapter` from project config + scenario:
 * `scenario.userFixture === undefined` resolves to an `anonymous` adapter
 * with `expectedUser: 'anonymous'`. Otherwise the fixture is looked up by
 * `id` in `config.adapters.user.fixtures`: a fixture with a
 * `storageStateRef` resolves to `storage-state`; without one it resolves to
 * a named `anonymous` fixture; an unknown id throws `UserFixtureConfigError`.
 */
export function createUserFixtureAdapter(
  scenario: Scenario,
  config: ProjectConfig,
  loader: StorageStateLoader
): StorageStateUserFixtureAdapter {
  const debugSignal = config.adapters.user.debugSignal ?? DEFAULT_DEBUG_SIGNAL;

  if (scenario.userFixture === undefined) {
    return new StorageStateUserFixtureAdapter({
      strategy: 'anonymous',
      expectedUser: 'anonymous',
      debugSignal
    });
  }

  const def = config.adapters.user.fixtures.find((f) => f.id === scenario.userFixture);
  if (!def) {
    throw new UserFixtureConfigError(
      `No user fixture "${scenario.userFixture}" is defined in adapters.user.fixtures`
    );
  }

  if (def.storageStateRef) {
    return new StorageStateUserFixtureAdapter({
      strategy: 'storage-state',
      expectedUser: def.id,
      debugSignal,
      storageStateRef: def.storageStateRef,
      loader
    });
  }

  return new StorageStateUserFixtureAdapter({
    strategy: 'anonymous',
    expectedUser: def.id,
    debugSignal
  });
}

/** Thrown by `assertUserFixtureSatisfied` when the effective user does not match. */
export class UserFixtureVerificationError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string) {
    super(message);
    this.name = 'UserFixtureVerificationError';
    this.normalized = normalizeError(message, {
      category: 'state_verification_error',
      phase: 'state_verification'
    });
  }
}

/** Thrown by `createUserFixtureAdapter` when a referenced fixture id is undefined. */
export class UserFixtureConfigError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string) {
    super(message);
    this.name = 'UserFixtureConfigError';
    this.normalized = normalizeError(message, {
      category: 'configuration_error',
      phase: 'planning'
    });
  }
}

/**
 * Throws a normalized `state_verification_error` (phase `state_verification`)
 * naming the strategy and expected user (no effective-user value, no auth
 * material) when the verification did not report `satisfied`. `verify()`
 * itself never throws; callers decide whether to assert.
 */
export function assertUserFixtureSatisfied(
  verification: UserFixtureVerification,
  descriptor: { strategy: UserFixtureStrategy; expectedUser: string }
): void {
  if (verification.satisfied) return;

  const reason = verification.present ? 'user mismatch' : 'no user signal';
  throw new UserFixtureVerificationError(
    `User fixture (strategy "${descriptor.strategy}") did not satisfy the expected user ` +
      `"${descriptor.expectedUser}" (${reason})`
  );
}
