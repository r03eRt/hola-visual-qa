import type { Scenario } from '../domain/index.js';

/**
 * Country override contract: the SPEC-007 `country` scenario dimension. See
 * docs/features/country-adapter/SPEC.md for the canonical `apply`/`verify`/
 * `describeRedacted` contract, mirroring the SPEC-002 consent adapter and the
 * SPEC-006 ad-state adapter. This adapter forces the scenario's `country`
 * into a known state via an explicit, approved staging mechanism (header or
 * cookie) — or performs no override at all (`none`) — and verifies the
 * EFFECTIVE country via a platform-provided debug signal. It makes NO claim
 * about real geo-IP resolution; `describeRedacted()` always states the
 * strategy used so results are never misrepresented as real geo-IP tests.
 */
export type CountryCode = Scenario['country'];

/** Supported country-override strategies. `query`/`proxy` are deferred (out of scope). */
export type CountryStrategy = 'header' | 'cookie' | 'none';

/**
 * Minimal structural interface for the object a country adapter uses to
 * install its header/cookie override before navigation. A real Playwright
 * `BrowserContext` satisfies this shape, but tests can inject a fake with no
 * real browser involved.
 */
export interface CountryContextLike {
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  addCookies(
    cookies: ReadonlyArray<{
      name: string;
      value: string;
      domain: string;
      path: string;
      secure: boolean;
      sameSite: 'Lax' | 'Strict' | 'None';
    }>
  ): Promise<void>;
}

/**
 * Minimal structural interface for the object a country adapter uses to
 * verify the effective country after navigation. A real Playwright `Page`
 * satisfies this shape.
 */
export interface CountryVerifyPageLike {
  evaluate<R>(fn: (signal: string) => R, arg: string): Promise<R>;
}

/** Result of reading back the platform-provided country debug signal. */
export interface CountryVerification {
  /** Whether the effective (case-insensitive) country matches the expected one. */
  satisfied: boolean;
  /** Whether the debug signal returned a non-empty string at all. */
  present: boolean;
  /** The country the debug signal reports, or `null` when absent/invalid. */
  effective: string | null;
  /** The country requested/applied for this scenario. */
  expectedCountry: CountryCode;
  /** The strategy that was applied. */
  strategy: CountryStrategy;
}

/** Report-safe descriptor of a country adapter's configuration. */
export interface RedactedCountryDescriptor {
  strategy: CountryStrategy;
  expectedCountry: CountryCode;
  /** 'header <name>' | 'cookie <name>' | 'none' — report-safe, no secrets. */
  mechanism: string;
}

/**
 * Contract every country-override strategy implements: apply the requested
 * country before navigation, verify the effective country afterwards (never
 * assumed), and describe itself in a report-safe way so results are never
 * misrepresented as real geo-IP tests.
 */
export interface CountryAdapter {
  apply(context: CountryContextLike): Promise<void>;
  verify(page: CountryVerifyPageLike): Promise<CountryVerification>;
  describeRedacted(): RedactedCountryDescriptor;
}
