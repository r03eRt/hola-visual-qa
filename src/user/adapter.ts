import type { Scenario } from '../domain/index.js';

/**
 * User fixture contract: the `Scenario.userFixture` scenario dimension. See
 * docs/features/user-fixtures/SPEC.md for the canonical `apply`/`verify`/
 * `describeRedacted` contract, mirroring the SPEC-002 consent adapter, the
 * SPEC-006 ad-state adapter and the SPEC-007 country adapter. This adapter
 * puts a scenario into a known user state — either `anonymous` (logged-out;
 * no-op) or `storage-state` (apply a fixture's Playwright storageState via an
 * injected loader, never touching the filesystem itself) — before
 * navigation, then verifies the EFFECTIVE user by reading a
 * platform-provided debug signal back (never assumed). `describeRedacted()`
 * never exposes auth material, ref paths, cookies or tokens.
 */
export type UserFixtureId = NonNullable<Scenario['userFixture']>;

/** Supported user-fixture strategies. */
export type UserFixtureStrategy = 'storage-state' | 'anonymous';

/** A single cookie in a Playwright storageState. */
export interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

/** A single origin's localStorage entries in a Playwright storageState. */
export interface StorageStateOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

/** A Playwright-shaped storageState: cookies plus per-origin localStorage. */
export interface StorageState {
  cookies: StorageStateCookie[];
  origins: StorageStateOrigin[];
}

/**
 * DI port: resolves a fixture's storage state WITHOUT this module doing any
 * filesystem I/O itself. The real fs-backed implementation is a later
 * wiring ticket (see docs/features/user-fixtures/SPEC.md "Non-goals").
 */
export interface StorageStateLoader {
  load(ref: string): Promise<StorageState>;
}

/**
 * Minimal structural interface for the object a user-fixture adapter uses to
 * apply cookies/localStorage before navigation. A real Playwright
 * `BrowserContext` satisfies this shape, but tests can inject a fake with no
 * real browser involved.
 */
export interface UserFixtureContextLike {
  addCookies(cookies: ReadonlyArray<StorageStateCookie>): Promise<void>;
  addInitScript(
    script: (arg: { origins: StorageStateOrigin[] }) => void,
    arg: { origins: StorageStateOrigin[] }
  ): Promise<void>;
}

/**
 * Minimal structural interface for the object a user-fixture adapter uses to
 * verify the effective user after navigation. A real Playwright `Page`
 * satisfies this shape.
 */
export interface UserFixtureVerifyPageLike {
  evaluate<R>(fn: (signal: string) => R, arg: string): Promise<R>;
}

/** Result of reading back the platform-provided user debug signal. */
export interface UserFixtureVerification {
  /** Whether the effective user matches what was expected for this strategy. */
  satisfied: boolean;
  /** Whether the debug signal returned a non-empty string at all. */
  present: boolean;
  /** The user id the debug signal reports, or `null` when absent/invalid. */
  effectiveUser: string | null;
  /** The user id requested/applied for this scenario ('anonymous' when logged out). */
  expectedUser: UserFixtureId | 'anonymous';
  /** The strategy that was applied. */
  strategy: UserFixtureStrategy;
}

/** Report-safe descriptor of a user-fixture adapter's configuration. */
export interface RedactedUserFixtureDescriptor {
  strategy: UserFixtureStrategy;
  expectedUser: UserFixtureId | 'anonymous';
  /** true only for 'storage-state' — never exposes the ref, cookies or tokens. */
  hasAuthState: boolean;
}

/**
 * Contract every user-fixture strategy implements: apply the requested user
 * state before navigation, verify the effective user afterwards (never
 * assumed), and describe itself in a report-safe way — never exposing auth
 * material, ref paths, cookies or tokens.
 */
export interface UserFixtureAdapter {
  apply(context: UserFixtureContextLike): Promise<void>;
  verify(page: UserFixtureVerifyPageLike): Promise<UserFixtureVerification>;
  describeRedacted(): RedactedUserFixtureDescriptor;
}
