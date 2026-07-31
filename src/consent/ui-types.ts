import type { ConsentPageLike } from './adapter.js';

/**
 * Minimal structural interface for a Playwright-like locator, as used by the
 * resilient CMP UI interaction in `ui.ts`. A real Playwright `Locator`
 * satisfies this shape, but tests can inject a fake with no real browser.
 */
export interface ConsentLocatorLike {
  first(): ConsentLocatorLike;
  isVisible(): Promise<boolean>;
  click(options?: { timeout?: number }): Promise<void>;
}

/**
 * Minimal structural interface for the object used to locate CMP UI
 * elements by role/test-id. A real Playwright `Page` satisfies this shape.
 */
export interface ConsentUiPageLike {
  getByRole(role: 'button', options?: { name?: string | RegExp }): ConsentLocatorLike;
  getByTestId(testId: string): ConsentLocatorLike;
}

/**
 * Combined page shape needed to both verify the cookie signal (`context()`,
 * from `ConsentPageLike`) and interact with / inspect the CMP UI
 * (`ConsentUiPageLike`). A real Playwright `Page` satisfies this shape.
 */
export type ConsentVerifyPageLike = ConsentPageLike & ConsentUiPageLike;
