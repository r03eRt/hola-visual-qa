import type { ProjectConfig } from '../config/schema.js';
import type { Scenario } from '../domain/index.js';
import { normalizeError, type NormalizedError } from '../domain/error.js';
import type {
  ConsentAdapter,
  ConsentContextLike,
  ConsentPageLike,
  ConsentState,
  ConsentVerification,
  RedactedConsentDescriptor
} from './adapter.js';

const DEFAULT_COOKIE_NAME = 'consent_status';

/** Default state -> cookie value mapping, matching the legacy scaffold (value = state). */
function defaultValueForState(state: ConsentState): string {
  return state;
}

export interface CookieConsentAdapterOptions {
  state: ConsentState;
  cookieName: string;
  cookieDomain: string;
  valueForState?: (state: ConsentState) => string;
}

/**
 * Cookie-strategy consent adapter. Sets the consent cookie before navigation
 * and verifies the EFFECTIVE state by reading the cookie back — never
 * assumes it matches what was applied. Raw cookie values are never exposed
 * through `describeRedacted()` or `ConsentVerification`.
 */
export class CookieConsentAdapter implements ConsentAdapter {
  private readonly state: ConsentState;
  private readonly cookieName: string;
  private readonly cookieDomain: string;
  private readonly valueForState: (state: ConsentState) => string;

  constructor(options: CookieConsentAdapterOptions) {
    this.state = options.state;
    this.cookieName = options.cookieName;
    this.cookieDomain = options.cookieDomain;
    this.valueForState = options.valueForState ?? defaultValueForState;
  }

  async apply(context: ConsentContextLike): Promise<void> {
    await context.addCookies([
      {
        name: this.cookieName,
        value: this.valueForState(this.state),
        domain: this.cookieDomain,
        path: '/',
        secure: true,
        sameSite: 'Lax'
      }
    ]);
  }

  async verify(page: ConsentPageLike): Promise<ConsentVerification> {
    const cookies = await page.context().cookies();
    const matching = cookies.find(
      (cookie) => cookie.name === this.cookieName && (this.cookieDomain ? cookie.domain === this.cookieDomain : true)
    );

    const present = matching !== undefined;
    const expectedValue = this.valueForState(this.state);
    const satisfied = present && matching?.value === expectedValue;

    return { satisfied, present, expectedState: this.state };
  }

  describeRedacted(): RedactedConsentDescriptor {
    return {
      strategy: 'cookie',
      cookieName: this.cookieName,
      cookieDomain: this.cookieDomain,
      expectedState: this.state,
      cookieValue: '[redacted]'
    };
  }
}

/**
 * Resolves a `CookieConsentAdapter` from project config + scenario: cookie
 * name/domain come from `config.adapters.consent`, falling back to
 * `'consent_status'` and the `baseUrl` host respectively; the state to apply
 * is `scenario.consent`.
 */
export function createCookieConsentAdapter(scenario: Scenario, config: ProjectConfig): CookieConsentAdapter {
  const cookieName = config.adapters.consent.cookieName ?? DEFAULT_COOKIE_NAME;
  const cookieDomain = config.adapters.consent.cookieDomain ?? new URL(config.baseUrl).hostname;

  return new CookieConsentAdapter({
    state: scenario.consent,
    cookieName,
    cookieDomain
  });
}

/** Thrown by `assertConsentSatisfied` when the effective consent state does not match. */
export class ConsentVerificationError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string) {
    super(message);
    this.name = 'ConsentVerificationError';
    this.normalized = normalizeError(message, {
      category: 'state_verification_error',
      phase: 'state_verification'
    });
  }
}

/**
 * Throws a normalized `state_verification_error` (phase `state_verification`)
 * with a redacted message (cookie name/domain/expected state only — never
 * the raw cookie value) when the verification did not report `satisfied`.
 * `verify()` itself never throws; callers decide whether to assert.
 */
export function assertConsentSatisfied(
  verification: ConsentVerification,
  descriptor: { cookieName: string; cookieDomain: string }
): void {
  if (verification.satisfied) return;

  const reason = verification.present ? 'value mismatch' : 'cookie absent';
  throw new ConsentVerificationError(
    `Consent cookie "${descriptor.cookieName}" (domain "${descriptor.cookieDomain}") did not satisfy the expected ` +
      `state "${verification.expectedState}" (${reason}).`
  );
}
