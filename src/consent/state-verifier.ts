import { normalizeError, type NormalizedError } from '../domain/error.js';
import type { ConsentAdapter, ConsentState, ConsentVerification } from './adapter.js';
import { DEFAULT_CONSENT_UI_SELECTORS, isConsentBannerVisible, type ConsentUiSelectors } from './ui.js';
import type { ConsentVerifyPageLike } from './ui-types.js';

/**
 * Combined effective-state report: the cookie signal (from
 * `ConsentAdapter.verify`) AND the CMP banner-dismissed signal. NEVER
 * includes the raw cookie value — only enough to diagnose which signal
 * failed.
 */
export interface ConsentStateReport {
  expectedState: ConsentState;
  satisfied: boolean;
  signals: {
    cookie: ConsentVerification;
    bannerDismissed: boolean;
  };
}

export interface VerifyConsentStateOptions {
  selectors?: ConsentUiSelectors;
}

/**
 * Verifies the effective consent state is really in effect by combining the
 * cookie read-back (`adapter.verify`) with the CMP banner no longer being
 * visible. `satisfied` is true only when BOTH signals hold, so the report
 * shows exactly which signal failed when it doesn't.
 */
export async function verifyConsentState(
  page: ConsentVerifyPageLike,
  adapter: ConsentAdapter,
  options: VerifyConsentStateOptions = {}
): Promise<ConsentStateReport> {
  const selectors = options.selectors ?? DEFAULT_CONSENT_UI_SELECTORS;

  const cookie = await adapter.verify(page);
  const bannerDismissed = !(await isConsentBannerVisible(page, selectors));

  return {
    expectedState: cookie.expectedState,
    satisfied: cookie.satisfied && bannerDismissed,
    signals: { cookie, bannerDismissed }
  };
}

/** Thrown by `assertConsentState` when the effective consent state is not satisfied. */
export class ConsentStateVerificationError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string) {
    super(message);
    this.name = 'ConsentStateVerificationError';
    this.normalized = normalizeError(message, {
      category: 'state_verification_error',
      phase: 'state_verification'
    });
  }
}

function describeFailingSignals(report: ConsentStateReport): string {
  const failing: string[] = [];
  if (!report.signals.cookie.satisfied) {
    failing.push(report.signals.cookie.present ? 'cookie value mismatch' : 'cookie absent');
  }
  if (!report.signals.bannerDismissed) {
    failing.push('CMP banner still visible');
  }
  return failing.join('; ');
}

/**
 * Throws a normalized `state_verification_error` (phase `state_verification`)
 * with a REDACTED message (cookie name/domain/expected state and which
 * signal(s) failed — never the raw cookie value) when `!report.satisfied`.
 * Never throws when satisfied.
 */
export function assertConsentState(
  report: ConsentStateReport,
  descriptor: { cookieName: string; cookieDomain: string }
): void {
  if (report.satisfied) return;

  const reason = describeFailingSignals(report);
  throw new ConsentStateVerificationError(
    `Effective consent state for cookie "${descriptor.cookieName}" (domain "${descriptor.cookieDomain}") did not ` +
      `satisfy the expected state "${report.expectedState}" (${reason}).`
  );
}
