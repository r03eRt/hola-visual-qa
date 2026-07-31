/**
 * Deterministic, human-readable scenario ID generation.
 *
 * Format: `<page>-<device>-<consent>-<country>-<ads>`, e.g.
 * `home-desktop-accepted-es-ads_on`. Every segment is derived from
 * NORMALIZED dimension values (not raw input order), so the same logical
 * scenario always produces the same ID regardless of how the source
 * `ProjectConfig` arrays were ordered:
 *
 * - `page`   — slug of `page.name` if present, else slug of `page.path`
 *              (e.g. `/` -> `root`, `/about-us` -> `about-us`).
 * - `device` — `desktop` | `mobile`, used as-is (already a closed enum).
 * - `consent`— `accepted` | `rejected`, used as-is (already a closed enum).
 * - `country`— the country code, lowercased.
 * - `ads`    — `ads_on` when ads are enabled, `ads_off` otherwise.
 */

export interface ScenarioIdParts {
  page: { path: string; name?: string };
  device: 'desktop' | 'mobile';
  consent: 'accepted' | 'rejected';
  country: string;
  adsEnabled: boolean;
}

/**
 * Deterministic slug: lowercase, any run of non-alphanumeric characters
 * collapses to a single `-`, leading/trailing dashes trimmed. Falls back to
 * `root` for inputs that slugify to an empty string (e.g. the `/` path).
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'root';
}

function pageSlug(page: { path: string; name?: string }): string {
  return slugify(page.name ?? page.path);
}

export function buildScenarioId(parts: ScenarioIdParts): string {
  const segments = [
    pageSlug(parts.page),
    parts.device,
    parts.consent,
    slugify(parts.country),
    parts.adsEnabled ? 'ads_on' : 'ads_off'
  ];
  return segments.join('-');
}
