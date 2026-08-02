import { z } from 'zod';

/**
 * URL discovery contract (SPEC-010): turns a sitemap document into a
 * normalized, deduplicated, host-allowlisted, route-filtered, size-limited
 * URL inventory. See docs/features/url-sitemap-discovery/SPEC.md. This
 * module performs NO network or filesystem I/O itself — fetching is
 * injected via `SitemapFetcher` so unit tests stay 100% hermetic.
 */

/** A single discovered page: its pathname and the absolute normalized URL. */
export interface DiscoveredPage {
  /** Pathname only, starts with '/'. */
  path: string;
  /** Absolute normalized URL (origin + path), no query or fragment. */
  url: string;
}

export const DiscoveredPageSchema = z
  .object({
    path: z.string().min(1),
    url: z.string().min(1)
  })
  .strict();

// A conservative, case-insensitive denylist of field names that must never
// appear on a serialized inventory object. Mirrors src/domain/result.ts'
// SECRET_FIELD_PATTERN/rejectSecretLikeKeys, duplicated locally so this
// module has no dependency on ../domain.
const SECRET_FIELD_PATTERN =
  /^(api[-_]?key|apikey|api[-_]?token|access[-_]?token|authorization|auth|cookie|cookies|secret|password|token|storagestate|storage_state)$/i;

function rejectSecretLikeKeys(shapeName: string) {
  return (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
    for (const key of Object.keys(value)) {
      if (SECRET_FIELD_PATTERN.test(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `${shapeName} must not contain a secret-looking field: "${key}"`,
          path: [key]
        });
      }
    }
  };
}

export const UrlInventorySchema = z
  .object({
    source: z.enum(['sitemap']),
    pages: z.array(DiscoveredPageSchema)
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('UrlInventory'));

export type UrlInventory = z.output<typeof UrlInventorySchema>;

/** Options controlling a single discovery run. */
export interface DiscoveryOptions {
  /** Case-insensitive exact-match allowlist of hostnames. */
  allowedHosts: string[];
  /** Base URL used to resolve relative `<loc>` entries. */
  baseUrl?: string;
  /** Hard cap on the number of pages kept in the resulting inventory. */
  maxUrls: number;
  /** Extra ignore-route patterns, appended to `DEFAULT_IGNORED_PATH_PATTERNS`. */
  ignorePathPatterns?: readonly RegExp[];
}

/** Result of a discovery run: the inventory plus every drop counter. */
export interface DiscoveryOutcome {
  inventory: UrlInventory;
  /** Raw `<loc>` count before any filtering. */
  totalFound: number;
  /** Pages actually kept in the inventory. */
  keptCount: number;
  /** Entries dropped for being unparseable or off the host allowlist. */
  outOfHostCount: number;
  /** Entries dropped by ignore-route filtering. */
  ignoredCount: number;
  /** Entries dropped as duplicates of an already-kept URL. */
  duplicateCount: number;
  /** Entries dropped solely because they exceeded `maxUrls`. */
  truncatedCount: number;
}

/**
 * Dependency-injection port for fetching a sitemap document. Real
 * network/filesystem implementations are deferred (non-goal of this PR);
 * tests inject an in-memory fake.
 */
export interface SitemapFetcher {
  fetch(url: string): Promise<string>;
}
