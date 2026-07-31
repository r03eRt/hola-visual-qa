import type { ConsentState } from './adapter.js';
import type { ConsentLocatorLike, ConsentUiPageLike } from './ui-types.js';

/**
 * Role/test-id based selectors for the CMP banner. Resilient by
 * construction: no CSS selectors, no arbitrary sleeps. Matches the legacy
 * `setConsentThroughUi` regex defaults (`consent-manager.ts`), extended with
 * an optional banner test-id for a more precise presence check.
 */
export interface ConsentUiSelectors {
  acceptName: RegExp;
  rejectName: RegExp;
  bannerTestId?: string;
}

export const DEFAULT_CONSENT_UI_SELECTORS: ConsentUiSelectors = {
  acceptName: /accept|aceptar/i,
  rejectName: /reject|rechazar/i
};

/** Outcome of attempting to apply consent through the CMP UI. */
export interface ConsentUiOutcome {
  /** Whether a visible accept/reject button was found and clicked. */
  interacted: boolean;
}

function matcherForState(state: ConsentState, selectors: ConsentUiSelectors): RegExp {
  return state === 'accepted' ? selectors.acceptName : selectors.rejectName;
}

/**
 * Clicks the CMP accept/reject button (matched by role + accessible name)
 * corresponding to `state`, when it is visible. NEVER throws when the
 * banner/button is absent — returns `{ interacted: false }` instead. Uses a
 * bounded `isVisible()` check (guarded against rejection), not an arbitrary
 * `waitForTimeout`.
 */
export async function applyConsentThroughUi(
  page: ConsentUiPageLike,
  state: ConsentState,
  selectors: ConsentUiSelectors = DEFAULT_CONSENT_UI_SELECTORS
): Promise<ConsentUiOutcome> {
  const matcher = matcherForState(state, selectors);
  const button: ConsentLocatorLike = page.getByRole('button', { name: matcher }).first();

  const visible = await button.isVisible().catch(() => false);
  if (!visible) return { interacted: false };

  await button.click();
  return { interacted: true };
}

/**
 * Reports whether the CMP banner is currently visible: by `bannerTestId`
 * when configured, otherwise by the visibility of either the accept or the
 * reject button. Bounded checks only, guarded against rejection — never
 * throws.
 */
export async function isConsentBannerVisible(
  page: ConsentUiPageLike,
  selectors: ConsentUiSelectors = DEFAULT_CONSENT_UI_SELECTORS
): Promise<boolean> {
  if (selectors.bannerTestId) {
    return page
      .getByTestId(selectors.bannerTestId)
      .first()
      .isVisible()
      .catch(() => false);
  }

  const acceptVisible = await page.getByRole('button', { name: selectors.acceptName }).first().isVisible().catch(() => false);
  if (acceptVisible) return true;

  return page.getByRole('button', { name: selectors.rejectName }).first().isVisible().catch(() => false);
}
