/**
 * Pure sitemap → URL inventory pipeline. See
 * docs/features/url-sitemap-discovery/SPEC.md. Order of filters is
 * significant: parse → normalize → drop out-of-host → drop ignored routes
 * → dedupe → deterministic sort by url → cap at `maxUrls`. Every dropped
 * URL increments exactly one counter, so
 * `keptCount + outOfHostCount + ignoredCount + duplicateCount + truncatedCount === totalFound`.
 */

import { UrlInventorySchema, type DiscoveredPage, type DiscoveryOptions, type DiscoveryOutcome, type SitemapFetcher } from './contract.js';
import { isIgnoredPath } from './ignore.js';
import { normalizeUrl } from './normalize.js';
import { parseSitemapLocations } from './sitemap.js';

/**
 * Turns a sitemap XML document into a normalized, deduplicated,
 * host-allowlisted, route-filtered, size-limited `DiscoveryOutcome`. Pure —
 * performs no I/O.
 */
export function discoverFromSitemap(xml: string, options: DiscoveryOptions): DiscoveryOutcome {
  const locations = parseSitemapLocations(xml);
  const totalFound = locations.length;

  const allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));

  let outOfHostCount = 0;
  let ignoredCount = 0;
  const inScope: DiscoveredPage[] = [];

  for (const raw of locations) {
    const normalized = normalizeUrl(raw, options.baseUrl);
    if (normalized === null || normalized.host.length === 0 || !allowedHosts.has(normalized.host)) {
      outOfHostCount += 1;
      continue;
    }

    if (isIgnoredPath(normalized.path, options.ignorePathPatterns)) {
      ignoredCount += 1;
      continue;
    }

    inScope.push({ path: normalized.path, url: normalized.url });
  }

  let duplicateCount = 0;
  const seen = new Set<string>();
  const unique: DiscoveredPage[] = [];
  for (const page of inScope) {
    if (seen.has(page.url)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(page.url);
    unique.push(page);
  }

  const sorted = [...unique].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

  const truncatedCount = Math.max(0, sorted.length - options.maxUrls);
  const keptPages = sorted.slice(0, options.maxUrls);
  const keptCount = keptPages.length;

  const inventory = UrlInventorySchema.parse({ source: 'sitemap', pages: keptPages });

  return {
    inventory,
    totalFound,
    keptCount,
    outOfHostCount,
    ignoredCount,
    duplicateCount,
    truncatedCount
  };
}

/**
 * Awaits the injected `SitemapFetcher` for `sitemapUrl`, then runs
 * `discoverFromSitemap` on the fetched document. Fetch errors propagate to
 * the caller.
 */
export async function discoverUrls(
  fetcher: SitemapFetcher,
  sitemapUrl: string,
  options: DiscoveryOptions
): Promise<DiscoveryOutcome> {
  const xml = await fetcher.fetch(sitemapUrl);
  return discoverFromSitemap(xml, options);
}
