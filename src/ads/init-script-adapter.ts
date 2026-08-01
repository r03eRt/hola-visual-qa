import type { ProjectConfig } from '../config/schema.js';
import type { Scenario } from '../domain/index.js';
import { normalizeError, type NormalizedError } from '../domain/error.js';
import type {
  AdStateAdapter,
  AdStateContextLike,
  AdStateVerifyPageLike,
  AdStateVerification,
  RedactedAdStateDescriptor
} from './adapter.js';

const DEFAULT_FLAG_NAME = '__ADS_ENABLED__';

export interface InitScriptAdStateAdapterOptions {
  enabled: boolean;
  flagName: string;
}

/**
 * Init-script-strategy ad-state adapter. Installs the documented `window`
 * hook before any page script runs and verifies the EFFECTIVE state by
 * reading the hook back — never assumes it matches what was applied.
 */
export class InitScriptAdStateAdapter implements AdStateAdapter {
  private readonly enabled: boolean;
  private readonly flagName: string;

  constructor(options: InitScriptAdStateAdapterOptions) {
    this.enabled = options.enabled;
    this.flagName = options.flagName;
  }

  async apply(context: AdStateContextLike): Promise<void> {
    await context.addInitScript(
      (arg) => {
        (window as unknown as Record<string, unknown>)[arg.flagName] = arg.enabled;
      },
      { flagName: this.flagName, enabled: this.enabled }
    );
  }

  async verify(page: AdStateVerifyPageLike): Promise<AdStateVerification> {
    const value = await page.evaluate(
      (name) => (window as unknown as Record<string, unknown>)[name],
      this.flagName
    );

    const present = typeof value === 'boolean';
    const satisfied = present && value === this.enabled;

    return { satisfied, present, expectedEnabled: this.enabled };
  }

  describeRedacted(): RedactedAdStateDescriptor {
    return {
      strategy: 'init-script',
      flagName: this.flagName,
      expectedEnabled: this.enabled
    };
  }
}

/**
 * Resolves an `InitScriptAdStateAdapter` from project config + scenario: the
 * hook name comes from `config.adapters.ads.flagName`, falling back to
 * `'__ADS_ENABLED__'`; the state to apply is `scenario.adsEnabled`.
 */
export function createAdStateAdapter(scenario: Scenario, config: ProjectConfig): InitScriptAdStateAdapter {
  const flagName = config.adapters.ads.flagName ?? DEFAULT_FLAG_NAME;

  return new InitScriptAdStateAdapter({
    enabled: scenario.adsEnabled,
    flagName
  });
}

/** Thrown by `assertAdStateSatisfied` when the effective ad-state hook does not match. */
export class AdStateVerificationError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string) {
    super(message);
    this.name = 'AdStateVerificationError';
    this.normalized = normalizeError(message, {
      category: 'state_verification_error',
      phase: 'state_verification'
    });
  }
}

/**
 * Throws a normalized `state_verification_error` (phase `state_verification`)
 * naming the hook and expected state (no raw page data) when the
 * verification did not report `satisfied`. `verify()` itself never throws;
 * callers decide whether to assert.
 */
export function assertAdStateSatisfied(
  verification: AdStateVerification,
  descriptor: { flagName: string }
): void {
  if (verification.satisfied) return;

  const reason = verification.present ? 'value mismatch' : 'hook absent';
  throw new AdStateVerificationError(
    `Ad-state hook "${descriptor.flagName}" did not satisfy the expected enabled state ` +
      `"${verification.expectedEnabled}" (${reason}).`
  );
}
