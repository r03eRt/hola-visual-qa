import { test, expect } from '@playwright/test';
import { parseSitemapLocations } from '../../src/discovery/sitemap.js';

test.describe('parseSitemapLocations', () => {
  test('extracts <loc> values from a plain sitemap', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>`;
    expect(parseSitemapLocations(xml)).toEqual(['https://example.com/', 'https://example.com/about']);
  });

  test('extracts <loc> values from a namespaced sitemap', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ns:urlset xmlns:ns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <ns:url><ns:loc>https://example.com/foo</ns:loc></ns:url>
</ns:urlset>`;
    expect(parseSitemapLocations(xml)).toEqual(['https://example.com/foo']);
  });

  test('is tolerant of surrounding whitespace and newlines', () => {
    const xml = `<url><loc>
      https://example.com/bar
    </loc></url>`;
    expect(parseSitemapLocations(xml)).toEqual(['https://example.com/bar']);
  });

  test('unwraps CDATA-wrapped locations', () => {
    const xml = `<url><loc><![CDATA[https://example.com/cdata?x=1&y=2]]></loc></url>`;
    expect(parseSitemapLocations(xml)).toEqual(['https://example.com/cdata?x=1&y=2']);
  });

  test('unescapes XML entities', () => {
    const xml = `<url><loc>https://example.com/search?q=a&amp;b=&quot;c&quot;&amp;d=&#39;e&#39;</loc></url>`;
    expect(parseSitemapLocations(xml)).toEqual([`https://example.com/search?q=a&b="c"&d='e'`]);
  });

  test('drops empty <loc> elements', () => {
    const xml = `<url><loc></loc></url><url><loc>   </loc></url><url><loc>https://example.com/kept</loc></url>`;
    expect(parseSitemapLocations(xml)).toEqual(['https://example.com/kept']);
  });

  test('returns [] for an empty string', () => {
    expect(parseSitemapLocations('')).toEqual([]);
  });

  test('returns [] for garbage/non-sitemap input without throwing', () => {
    expect(() => parseSitemapLocations('not xml at all {}[]<><<<')).not.toThrow();
    expect(parseSitemapLocations('not xml at all {}[]<><<<')).toEqual([]);
    expect(parseSitemapLocations('<html><body>hello</body></html>')).toEqual([]);
  });
});
