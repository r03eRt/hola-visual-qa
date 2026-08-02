import { test, expect } from '@playwright/test';
import { discoverFromSitemap, discoverUrls } from '../../src/discovery/discover.js';
import { UrlInventorySchema, type SitemapFetcher } from '../../src/discovery/contract.js';

function buildSitemap(locs: readonly string[]): string {
  const entries = locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${entries}</urlset>`;
}

const MIXED_LOCS = [
  'https://example.com/',
  'https://example.com/about',
  'https://other.com/page',
  'not a url at all',
  'https://example.com/logout',
  'https://example.com/about',
  'https://example.com/about/',
  'https://example.com/products',
  'https://example.com/blog',
  'https://example.com/contact'
];

test.describe('discoverFromSitemap', () => {
  test('produces a filtered, deduplicated, sorted, capped inventory with exact counters', () => {
    const xml = buildSitemap(MIXED_LOCS);
    const outcome = discoverFromSitemap(xml, { allowedHosts: ['example.com'], maxUrls: 3 });

    expect(outcome.totalFound).toBe(10);
    expect(outcome.outOfHostCount).toBe(2); // other.com + unparseable
    expect(outcome.ignoredCount).toBe(1); // /logout
    expect(outcome.duplicateCount).toBe(2); // duplicate /about entries
    expect(outcome.truncatedCount).toBe(2); // 5 unique - maxUrls 3
    expect(outcome.keptCount).toBe(3);

    // Every drop is accounted for exactly once.
    expect(
      outcome.keptCount +
        outcome.outOfHostCount +
        outcome.ignoredCount +
        outcome.duplicateCount +
        outcome.truncatedCount
    ).toBe(outcome.totalFound);

    expect(outcome.inventory.source).toBe('sitemap');
    expect(outcome.inventory.pages).toEqual([
      { path: '/', url: 'https://example.com/' },
      { path: '/about', url: 'https://example.com/about' },
      { path: '/blog', url: 'https://example.com/blog' }
    ]);

    // Sorted deterministically by url.
    const urls = outcome.inventory.pages.map((page) => page.url);
    expect([...urls].sort()).toEqual(urls);

    // Only allowed-host URLs, no ignored routes, no duplicates.
    for (const page of outcome.inventory.pages) {
      expect(page.url.startsWith('https://example.com')).toBe(true);
      expect(page.path).not.toContain('logout');
    }
    expect(new Set(urls).size).toBe(urls.length);
  });

  test('is case-insensitive when matching allowedHosts', () => {
    const xml = buildSitemap(['https://Example.COM/page']);
    const outcome = discoverFromSitemap(xml, { allowedHosts: ['example.com'], maxUrls: 10 });
    expect(outcome.keptCount).toBe(1);
    expect(outcome.inventory.pages[0]).toEqual({ path: '/page', url: 'https://example.com/page' });
  });

  test('honors extra ignorePathPatterns in addition to the defaults', () => {
    const xml = buildSitemap(['https://example.com/promo', 'https://example.com/about']);
    const outcome = discoverFromSitemap(xml, {
      allowedHosts: ['example.com'],
      maxUrls: 10,
      ignorePathPatterns: [/promo/i]
    });
    expect(outcome.ignoredCount).toBe(1);
    expect(outcome.keptCount).toBe(1);
    expect(outcome.inventory.pages[0].path).toBe('/about');
  });

  test('resolves relative locs using baseUrl', () => {
    const xml = buildSitemap(['/relative']);
    const outcome = discoverFromSitemap(xml, {
      allowedHosts: ['example.com'],
      baseUrl: 'https://example.com',
      maxUrls: 10
    });
    expect(outcome.keptCount).toBe(1);
    expect(outcome.inventory.pages[0]).toEqual({ path: '/relative', url: 'https://example.com/relative' });
  });

  test('returns an empty inventory for empty/garbage sitemap input', () => {
    const outcome = discoverFromSitemap('not xml at all', { allowedHosts: ['example.com'], maxUrls: 10 });
    expect(outcome.totalFound).toBe(0);
    expect(outcome.keptCount).toBe(0);
    expect(outcome.inventory.pages).toEqual([]);
  });
});

test.describe('discoverUrls', () => {
  test('awaits an injected in-memory SitemapFetcher and returns the pure outcome', async () => {
    const xml = buildSitemap(MIXED_LOCS);
    const fetchedUrls: string[] = [];
    const fakeFetcher: SitemapFetcher = {
      fetch: async (url: string) => {
        fetchedUrls.push(url);
        return xml;
      }
    };

    const outcome = await discoverUrls(fakeFetcher, 'https://example.com/sitemap.xml', {
      allowedHosts: ['example.com'],
      maxUrls: 3
    });

    expect(fetchedUrls).toEqual(['https://example.com/sitemap.xml']);
    expect(outcome).toEqual(discoverFromSitemap(xml, { allowedHosts: ['example.com'], maxUrls: 3 }));
  });

  test('propagates fetch errors', async () => {
    const failingFetcher: SitemapFetcher = {
      fetch: async () => {
        throw new Error('network unavailable');
      }
    };

    await expect(
      discoverUrls(failingFetcher, 'https://example.com/sitemap.xml', {
        allowedHosts: ['example.com'],
        maxUrls: 10
      })
    ).rejects.toThrow('network unavailable');
  });
});

test.describe('UrlInventorySchema', () => {
  test('rejects a secret-looking top-level key', () => {
    const result = UrlInventorySchema.safeParse({
      source: 'sitemap',
      pages: [],
      apiKey: 'shh'
    });
    expect(result.success).toBe(false);
  });

  test('accepts a well-formed inventory', () => {
    const result = UrlInventorySchema.safeParse({
      source: 'sitemap',
      pages: [{ path: '/', url: 'https://example.com/' }]
    });
    expect(result.success).toBe(true);
  });
});
