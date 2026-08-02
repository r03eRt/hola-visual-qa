import type { ProjectConfig } from '../config/schema.js';
import type { Scenario } from '../domain/index.js';
import { normalizeError, type NormalizedError } from '../domain/error.js';
import type {
  CountryAdapter,
  CountryContextLike,
  CountryStrategy,
  CountryVerifyPageLike,
  CountryVerification,
  RedactedCountryDescriptor
} from './adapter.js';

const DEFAULT_HEADER_NAME = 'X-QA-Country';
const DEFAULT_COOKIE_NAME = 'qa_country';
const DEFAULT_DEBUG_SIGNAL = '__QA_COUNTRY__';

export interface StrategyCountryAdapterOptions {
  strategy: CountryStrategy;
  country: string;
  headerName: string;
  cookieName: string;
  cookieDomain: string;
  debugSignal: string;
}

/**
 * Strategy-based country adapter. Applies the requested country via an
 * explicit, approved staging mechanism (`header`/`cookie`) or performs no
 * override (`none`) before any navigation, and verifies the EFFECTIVE
 * country by reading a platform-provided debug signal back — never assumes
 * it matches what was applied.
 */
export class StrategyCountryAdapter implements CountryAdapter {
  private readonly strategy: CountryStrategy;
  private readonly country: string;
  private readonly headerName: string;
  private readonly cookieName: string;
  private readonly cookieDomain: string;
  private readonly debugSignal: string;

  constructor(options: StrategyCountryAdapterOptions) {
    this.strategy = options.strategy;
    this.country = options.country;
    this.headerName = options.headerName;
    this.cookieName = options.cookieName;
    this.cookieDomain = options.cookieDomain;
    this.debugSignal = options.debugSignal;
  }

  async apply(context: CountryContextLike): Promise<void> {
    if (this.strategy === 'header') {
      await context.setExtraHTTPHeaders({ [this.headerName]: this.country });
      return;
    }

    if (this.strategy === 'cookie') {
      await context.addCookies([
        {
          name: this.cookieName,
          value: this.country,
          domain: this.cookieDomain,
          path: '/',
          secure: true,
          sameSite: 'Lax'
        }
      ]);
      return;
    }

    // 'none': no-op — the scenario runs at its local country.
  }

  async verify(page: CountryVerifyPageLike): Promise<CountryVerification> {
    const value = await page.evaluate(
      (name) => (window as unknown as Record<string, unknown>)[name],
      this.debugSignal
    );

    const effective = typeof value === 'string' && value.length > 0 ? value : null;
    const present = effective !== null;
    const satisfied = present && effective.toLowerCase() === this.country.toLowerCase();

    return {
      satisfied,
      present,
      effective,
      expectedCountry: this.country,
      strategy: this.strategy
    };
  }

  describeRedacted(): RedactedCountryDescriptor {
    const mechanism =
      this.strategy === 'header'
        ? `header ${this.headerName}`
        : this.strategy === 'cookie'
          ? `cookie ${this.cookieName}`
          : 'none';

    return {
      strategy: this.strategy,
      expectedCountry: this.country,
      mechanism
    };
  }
}

/**
 * Resolves a `StrategyCountryAdapter` from project config + scenario:
 * `strategy` comes from `config.adapters.country.strategy`;
 * `headerName`/`cookieName`/`debugSignal` from config with the documented
 * defaults; `cookieDomain` from `config.adapters.country.cookieDomain` else
 * the host of `config.baseUrl`; country from `scenario.country`.
 */
export function createCountryAdapter(scenario: Scenario, config: ProjectConfig): StrategyCountryAdapter {
  const strategy = config.adapters.country.strategy;
  const headerName = config.adapters.country.headerName ?? DEFAULT_HEADER_NAME;
  const cookieName = config.adapters.country.cookieName ?? DEFAULT_COOKIE_NAME;
  const debugSignal = config.adapters.country.debugSignal ?? DEFAULT_DEBUG_SIGNAL;
  const cookieDomain = config.adapters.country.cookieDomain ?? new URL(config.baseUrl).hostname;

  return new StrategyCountryAdapter({
    strategy,
    country: scenario.country,
    headerName,
    cookieName,
    cookieDomain,
    debugSignal
  });
}

/** Thrown by `assertCountrySatisfied` when the effective country does not match. */
export class CountryVerificationError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string) {
    super(message);
    this.name = 'CountryVerificationError';
    this.normalized = normalizeError(message, {
      category: 'state_verification_error',
      phase: 'state_verification'
    });
  }
}

/**
 * Throws a normalized `state_verification_error` (phase `state_verification`)
 * naming the strategy and expected country (no raw page data) when the
 * verification did not report `satisfied`. `verify()` itself never throws;
 * callers decide whether to assert.
 */
export function assertCountrySatisfied(
  verification: CountryVerification,
  descriptor: { strategy: CountryStrategy; expectedCountry: string }
): void {
  if (verification.satisfied) return;

  const reason = verification.present ? 'value mismatch' : 'debug signal absent';
  throw new CountryVerificationError(
    `Country override (strategy "${descriptor.strategy}") did not satisfy the expected country ` +
      `"${descriptor.expectedCountry}" (${reason})`
  );
}
