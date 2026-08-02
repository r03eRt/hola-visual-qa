import { test, expect } from '@playwright/test';
import { DEFAULT_IGNORED_PATH_PATTERNS, isIgnoredPath } from '../../src/discovery/ignore.js';

test.describe('isIgnoredPath', () => {
  test('matches logout/sign-out routes', () => {
    expect(isIgnoredPath('/logout')).toBe(true);
    expect(isIgnoredPath('/log-out')).toBe(true);
    expect(isIgnoredPath('/user/signout')).toBe(true);
    expect(isIgnoredPath('/user/sign-out')).toBe(true);
  });

  test('matches account/admin/unsubscribe/password/reset routes', () => {
    expect(isIgnoredPath('/account')).toBe(true);
    expect(isIgnoredPath('/account/settings')).toBe(true);
    expect(isIgnoredPath('/admin')).toBe(true);
    expect(isIgnoredPath('/unsubscribe')).toBe(true);
    expect(isIgnoredPath('/password/change')).toBe(true);
    expect(isIgnoredPath('/reset')).toBe(true);
  });

  test('matches destructive verbs', () => {
    expect(isIgnoredPath('/comments/delete')).toBe(true);
    expect(isIgnoredPath('/comments/remove')).toBe(true);
  });

  test('matches checkout/commerce routes', () => {
    expect(isIgnoredPath('/checkout')).toBe(true);
    expect(isIgnoredPath('/cart')).toBe(true);
    expect(isIgnoredPath('/order')).toBe(true);
  });

  test('does not match ordinary content pages', () => {
    expect(isIgnoredPath('/')).toBe(false);
    expect(isIgnoredPath('/about')).toBe(false);
    expect(isIgnoredPath('/news/article-title')).toBe(false);
    expect(isIgnoredPath('/products/orderly-desk')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(isIgnoredPath('/LOGOUT')).toBe(true);
    expect(isIgnoredPath('/Account')).toBe(true);
  });

  test('DEFAULT_IGNORED_PATH_PATTERNS is a non-empty readonly array of RegExp', () => {
    expect(DEFAULT_IGNORED_PATH_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of DEFAULT_IGNORED_PATH_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  test('respects extra patterns in addition to the defaults', () => {
    expect(isIgnoredPath('/promo-only-page')).toBe(false);
    expect(isIgnoredPath('/promo-only-page', [/promo/i])).toBe(true);
    // Defaults still apply when extra patterns are provided.
    expect(isIgnoredPath('/logout', [/promo/i])).toBe(true);
  });
});
