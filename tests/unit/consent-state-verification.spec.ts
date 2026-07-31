import { test, expect } from '@playwright/test';
import type { ConsentContextLike, ConsentState, ConsentVerification } from '../../src/consent/adapter.js';
import { CookieConsentAdapter } from '../../src/consent/cookie-adapter.js';
import type { ConsentLocatorLike, ConsentVerifyPageLike } from '../../src/consent/ui-types.js';
import { DEFAULT_CONSENT_UI_SELECTORS, applyConsentThroughUi, isConsentBannerVisible } from '../../src/consent/ui.js';
import { assertConsentState, verifyConsentState } from '../../src/consent/state-verifier.js';

const RAW_COOKIE_VALUE = '__super-secret-consent-value__';

/** Fake locator with scriptable visibility and a recording click(). */
class FakeConsentLocator implements ConsentLocatorLike {
  clickCalls = 0;

  constructor(private readonly visible: boolean) {}

  first(): ConsentLocatorLike {
    return this;
  }

  async isVisible(): Promise<boolean> {
    return this.visible;
  }

  async click(): Promise<void> {
    this.clickCalls += 1;
  }
}

/** Locator that always rejects isVisible(), to prove bounded/guarded checks. */
class RejectingConsentLocator implements ConsentLocatorLike {
  clickCalls = 0;

  first(): ConsentLocatorLike {
    return this;
  }

  async isVisible(): Promise<boolean> {
    throw new Error('boom: element detached');
  }

  async click(): Promise<void> {
    this.clickCalls += 1;
  }
}

/** Fake context — returns a scripted cookies() list (no addCookies recording needed here). */
class FakeConsentContext implements ConsentContextLike {
  scriptedCookies: ReadonlyArray<{ name: string; value: string; domain?: string }> = [];

  async addCookies(): Promise<void> {
    // no-op: not exercised by these tests
  }

  async cookies(): Promise<ReadonlyArray<{ name: string; value: string; domain?: string }>> {
    return this.scriptedCookies;
  }
}

interface FakePageOptions {
  cookies?: ReadonlyArray<{ name: string; value: string; domain?: string }>;
  acceptLocator?: ConsentLocatorLike;
  rejectLocator?: ConsentLocatorLike;
  testIdLocators?: Record<string, ConsentLocatorLike>;
}

/** Fake ConsentVerifyPageLike composing a cookie-returning context() with getByRole/getByTestId. */
class FakeConsentVerifyPage implements ConsentVerifyPageLike {
  private readonly ctx: FakeConsentContext;
  readonly acceptLocator: ConsentLocatorLike;
  readonly rejectLocator: ConsentLocatorLike;
  private readonly testIdLocators: Record<string, ConsentLocatorLike>;

  constructor(options: FakePageOptions = {}) {
    this.ctx = new FakeConsentContext();
    this.ctx.scriptedCookies = options.cookies ?? [];
    this.acceptLocator = options.acceptLocator ?? new FakeConsentLocator(false);
    this.rejectLocator = options.rejectLocator ?? new FakeConsentLocator(false);
    this.testIdLocators = options.testIdLocators ?? {};
  }

  context(): ConsentContextLike {
    return this.ctx;
  }

  getByRole(_role: 'button', options?: { name?: string | RegExp }): ConsentLocatorLike {
    const name = options?.name;
    if (name instanceof RegExp && name.source === DEFAULT_CONSENT_UI_SELECTORS.acceptName.source) {
      return this.acceptLocator;
    }
    if (name instanceof RegExp && name.source === DEFAULT_CONSENT_UI_SELECTORS.rejectName.source) {
      return this.rejectLocator;
    }
    // Fallback: not visible, so absence is safe by default.
    return new FakeConsentLocator(false);
  }

  getByTestId(testId: string): ConsentLocatorLike {
    return this.testIdLocators[testId] ?? new FakeConsentLocator(false);
  }
}

function cookieVerification(overrides: Partial<ConsentVerification> = {}): ConsentVerification {
  return { satisfied: true, present: true, expectedState: 'accepted', ...overrides };
}

test.describe('applyConsentThroughUi', () => {
  test('clicks the ACCEPT button for "accepted" state when visible, returns interacted:true', async () => {
    const acceptLocator = new FakeConsentLocator(true);
    const rejectLocator = new FakeConsentLocator(true);
    const page = new FakeConsentVerifyPage({ acceptLocator, rejectLocator });

    const outcome = await applyConsentThroughUi(page, 'accepted');

    expect(outcome).toEqual({ interacted: true });
    expect(acceptLocator.clickCalls).toBe(1);
    expect(rejectLocator.clickCalls).toBe(0);
  });

  test('clicks the REJECT button for "rejected" state when visible, returns interacted:true', async () => {
    const acceptLocator = new FakeConsentLocator(true);
    const rejectLocator = new FakeConsentLocator(true);
    const page = new FakeConsentVerifyPage({ acceptLocator, rejectLocator });

    const outcome = await applyConsentThroughUi(page, 'rejected');

    expect(outcome).toEqual({ interacted: true });
    expect(rejectLocator.clickCalls).toBe(1);
    expect(acceptLocator.clickCalls).toBe(0);
  });

  test('does not throw and returns interacted:false when the button is absent (not visible)', async () => {
    const acceptLocator = new FakeConsentLocator(false);
    const page = new FakeConsentVerifyPage({ acceptLocator });

    const outcome = await applyConsentThroughUi(page, 'accepted');

    expect(outcome).toEqual({ interacted: false });
    expect(acceptLocator.clickCalls).toBe(0);
  });

  test('does not throw and returns interacted:false when isVisible() rejects (bounded/guarded check)', async () => {
    const acceptLocator = new RejectingConsentLocator();
    const page = new FakeConsentVerifyPage({ acceptLocator });

    await expect(applyConsentThroughUi(page, 'accepted')).resolves.toEqual({ interacted: false });
    expect(acceptLocator.clickCalls).toBe(0);
  });

  test('supports custom selectors overriding the defaults', async () => {
    const customAccept = new FakeConsentLocator(true);
    class CustomSelectorPage implements ConsentVerifyPageLike {
      private readonly ctx = new FakeConsentContext();
      context(): ConsentContextLike {
        return this.ctx;
      }
      getByRole(_role: 'button', options?: { name?: string | RegExp }): ConsentLocatorLike {
        if (options?.name instanceof RegExp && options.name.source === 'ok') return customAccept;
        return new FakeConsentLocator(false);
      }
      getByTestId(): ConsentLocatorLike {
        return new FakeConsentLocator(false);
      }
    }
    const page = new CustomSelectorPage();

    const outcome = await applyConsentThroughUi(page, 'accepted', { acceptName: /ok/, rejectName: /no/ });

    expect(outcome).toEqual({ interacted: true });
    expect(customAccept.clickCalls).toBe(1);
  });
});

test.describe('isConsentBannerVisible', () => {
  test('reflects presence via bannerTestId when configured', async () => {
    const bannerLocator = new FakeConsentLocator(true);
    const page = new FakeConsentVerifyPage({ testIdLocators: { 'cmp-banner': bannerLocator } });

    const visible = await isConsentBannerVisible(page, { ...DEFAULT_CONSENT_UI_SELECTORS, bannerTestId: 'cmp-banner' });

    expect(visible).toBe(true);
  });

  test('reflects absence via bannerTestId when configured and not visible', async () => {
    const bannerLocator = new FakeConsentLocator(false);
    const page = new FakeConsentVerifyPage({ testIdLocators: { 'cmp-banner': bannerLocator } });

    const visible = await isConsentBannerVisible(page, { ...DEFAULT_CONSENT_UI_SELECTORS, bannerTestId: 'cmp-banner' });

    expect(visible).toBe(false);
  });

  test('falls back to accept/reject button visibility when no bannerTestId is configured', async () => {
    const page = new FakeConsentVerifyPage({
      acceptLocator: new FakeConsentLocator(false),
      rejectLocator: new FakeConsentLocator(true)
    });

    const visible = await isConsentBannerVisible(page);

    expect(visible).toBe(true);
  });

  test('is false when neither test-id nor accept/reject buttons are visible', async () => {
    const page = new FakeConsentVerifyPage({
      acceptLocator: new FakeConsentLocator(false),
      rejectLocator: new FakeConsentLocator(false)
    });

    const visible = await isConsentBannerVisible(page);

    expect(visible).toBe(false);
  });
});

test.describe('verifyConsentState', () => {
  test('satisfied:true only when cookie.satisfied AND bannerDismissed both hold', async () => {
    const adapter = new CookieConsentAdapter({ state: 'accepted', cookieName: 'consent_status', cookieDomain: 'example.com' });
    const page = new FakeConsentVerifyPage({
      cookies: [{ name: 'consent_status', value: 'accepted', domain: 'example.com' }],
      acceptLocator: new FakeConsentLocator(false),
      rejectLocator: new FakeConsentLocator(false)
    });

    const report = await verifyConsentState(page, adapter);

    expect(report.satisfied).toBe(true);
    expect(report.expectedState).toBe('accepted');
    expect(report.signals.cookie.satisfied).toBe(true);
    expect(report.signals.bannerDismissed).toBe(true);
  });

  test('fails by cookie only: satisfied:false, signals show cookie failed but banner dismissed', async () => {
    const adapter = new CookieConsentAdapter({ state: 'accepted', cookieName: 'consent_status', cookieDomain: 'example.com' });
    const page = new FakeConsentVerifyPage({
      cookies: [],
      acceptLocator: new FakeConsentLocator(false),
      rejectLocator: new FakeConsentLocator(false)
    });

    const report = await verifyConsentState(page, adapter);

    expect(report.satisfied).toBe(false);
    expect(report.signals.cookie.satisfied).toBe(false);
    expect(report.signals.cookie.present).toBe(false);
    expect(report.signals.bannerDismissed).toBe(true);
  });

  test('fails by banner only: satisfied:false, signals show cookie satisfied but banner still visible', async () => {
    const adapter = new CookieConsentAdapter({ state: 'accepted', cookieName: 'consent_status', cookieDomain: 'example.com' });
    const page = new FakeConsentVerifyPage({
      cookies: [{ name: 'consent_status', value: 'accepted', domain: 'example.com' }],
      acceptLocator: new FakeConsentLocator(true),
      rejectLocator: new FakeConsentLocator(false)
    });

    const report = await verifyConsentState(page, adapter);

    expect(report.satisfied).toBe(false);
    expect(report.signals.cookie.satisfied).toBe(true);
    expect(report.signals.bannerDismissed).toBe(false);
  });
});

test.describe('assertConsentState', () => {
  test('throws a normalized state_verification_error/state_verification when not satisfied', () => {
    const report = {
      expectedState: 'accepted' as ConsentState,
      satisfied: false,
      signals: { cookie: cookieVerification({ satisfied: false, present: false }), bannerDismissed: true }
    };

    let thrown: unknown;
    try {
      assertConsentState(report, { cookieName: 'consent_status', cookieDomain: 'example.com' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    const error = thrown as Error & { normalized?: { category: string; phase: string } };
    expect(error.normalized).toBeDefined();
    expect(error.normalized?.category).toBe('state_verification_error');
    expect(error.normalized?.phase).toBe('state_verification');
    expect(error.message).toContain('consent_status');
    expect(error.message).toContain('example.com');
  });

  test('does not throw when satisfied', () => {
    const report = {
      expectedState: 'accepted' as ConsentState,
      satisfied: true,
      signals: { cookie: cookieVerification(), bannerDismissed: true }
    };

    expect(() => assertConsentState(report, { cookieName: 'consent_status', cookieDomain: 'example.com' })).not.toThrow();
  });

  test('redaction: a distinctive raw cookie value never appears in JSON.stringify(report) nor in error.message', async () => {
    const adapter = new CookieConsentAdapter({ state: 'accepted', cookieName: 'consent_status', cookieDomain: 'example.com' });
    const page = new FakeConsentVerifyPage({
      cookies: [{ name: 'consent_status', value: RAW_COOKIE_VALUE, domain: 'example.com' }],
      acceptLocator: new FakeConsentLocator(true),
      rejectLocator: new FakeConsentLocator(false)
    });

    const report = await verifyConsentState(page, adapter);
    expect(JSON.stringify(report)).not.toContain(RAW_COOKIE_VALUE);

    let thrown: unknown;
    try {
      assertConsentState(report, { cookieName: 'consent_status', cookieDomain: 'example.com' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    const error = thrown as Error;
    expect(error.message).not.toContain(RAW_COOKIE_VALUE);
  });
});
