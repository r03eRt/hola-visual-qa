import type { Scenario } from '../domain/index.js';

/**
 * Consent state contract: what the SPEC-002 consent engine implements. See
 * docs/specs/SPEC-002-CONSENT-ENGINE.md for the canonical states and the
 * `apply`/`verify`/`describeRedacted` contract.
 */
export type ConsentState = Scenario['consent'];

/**
 * Minimal structural interface for the object a consent adapter uses to set
 * cookies before navigation. A real Playwright `BrowserContext` satisfies
 * this shape, but tests can inject a fake with no real browser involved.
 */
export interface ConsentContextLike {
  addCookies(
    cookies: ReadonlyArray<{
      name: string;
      value: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      sameSite?: 'Strict' | 'Lax' | 'None';
    }>
  ): Promise<void>;
  cookies(
    urls?: string | string[]
  ): Promise<ReadonlyArray<{ name: string; value: string; domain?: string }>>;
}

/**
 * Minimal structural interface for the object a consent adapter uses to
 * verify the effective state after navigation. A real Playwright `Page`
 * satisfies this shape.
 */
export interface ConsentPageLike {
  context(): ConsentContextLike;
}

/**
 * Result of reading back the effective consent state. NEVER includes the raw
 * cookie value — only enough to report pass/fail without leaking secrets.
 */
export interface ConsentVerification {
  /** Whether the effective cookie matches the expected state. */
  satisfied: boolean;
  /** Whether the consent cookie was present at all. */
  present: boolean;
  /** The state that was requested/applied for this scenario. */
  expectedState: ConsentState;
}

/** Report-safe descriptor of a consent adapter's configuration. */
export interface RedactedConsentDescriptor {
  strategy: 'cookie';
  cookieName: string;
  cookieDomain: string;
  expectedState: ConsentState;
  cookieValue: '[redacted]';
}

/**
 * Contract every consent adapter strategy implements: apply the consent
 * state before navigation, verify the effective state afterwards (never
 * assumed), and describe itself in a report-safe (redacted) way.
 */
export interface ConsentAdapter {
  apply(context: ConsentContextLike): Promise<void>;
  verify(page: ConsentPageLike): Promise<ConsentVerification>;
  describeRedacted(): RedactedConsentDescriptor;
}
