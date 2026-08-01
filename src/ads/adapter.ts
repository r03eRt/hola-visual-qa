import type { Scenario } from '../domain/index.js';

/**
 * Ad state contract: the SPEC-006 `ads_on`/`ads_off` scenario dimension. See
 * docs/features/ad-state-adapter/SPEC.md for the canonical `apply`/`verify`/
 * `describeRedacted` contract, mirroring the SPEC-002 consent adapter. This
 * adapter only sets and verifies the requested hook state; it makes NO claim
 * about ad fill, revenue, container presence, request or render.
 */
export type AdState = Scenario['adsEnabled'];

/**
 * Minimal structural interface for the object an ad-state adapter uses to
 * install its init-script hook before navigation. A real Playwright
 * `BrowserContext` satisfies this shape, but tests can inject a fake with no
 * real browser involved.
 */
export interface AdStateContextLike {
  addInitScript(
    script: (arg: { flagName: string; enabled: boolean }) => void,
    arg: { flagName: string; enabled: boolean }
  ): Promise<void>;
}

/**
 * Minimal structural interface for the object an ad-state adapter uses to
 * verify the effective state after navigation. A real Playwright `Page`
 * satisfies this shape.
 */
export interface AdStateVerifyPageLike {
  evaluate<R>(fn: (flagName: string) => R, arg: string): Promise<R>;
}

/** Result of reading back the effective ad-state hook. */
export interface AdStateVerification {
  /** Whether the effective hook value matches the expected state. */
  satisfied: boolean;
  /** Whether the hook was defined (a boolean) at all. */
  present: boolean;
  /** The state that was requested/applied for this scenario. */
  expectedEnabled: AdState;
}

/** Report-safe descriptor of an ad-state adapter's configuration. */
export interface RedactedAdStateDescriptor {
  strategy: 'init-script';
  flagName: string;
  expectedEnabled: AdState;
}

/**
 * Contract every ad-state adapter strategy implements: apply the requested
 * state before navigation, verify the effective state afterwards (never
 * assumed), and describe itself in a report-safe way.
 */
export interface AdStateAdapter {
  apply(context: AdStateContextLike): Promise<void>;
  verify(page: AdStateVerifyPageLike): Promise<AdStateVerification>;
  describeRedacted(): RedactedAdStateDescriptor;
}
