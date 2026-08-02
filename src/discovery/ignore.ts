/**
 * Ignore-route filtering for discovery. See
 * docs/features/url-sitemap-discovery/SPEC.md. Drops logout, destructive
 * and account-action routes so they never end up in a discovered URL
 * inventory.
 */

export const DEFAULT_IGNORED_PATH_PATTERNS: readonly RegExp[] = [
  // logout / sign-out
  /(?:^|\/)(logout|log-out|signout|sign-out)(?:\/|$)/i,
  // destructive verbs
  /(?:^|\/)(delete|remove)(?:\/|$)/i,
  // account/profile actions
  /(?:^|\/)(account|profile|admin|unsubscribe|password|reset)(?:\/|$)/i,
  // checkout/commerce flows
  /(?:^|\/)(checkout|cart|order)(?:\/|$)/i
];

/**
 * True when `path` matches any of `DEFAULT_IGNORED_PATH_PATTERNS` or the
 * provided `extraPatterns`.
 */
export function isIgnoredPath(path: string, extraPatterns?: readonly RegExp[]): boolean {
  for (const pattern of DEFAULT_IGNORED_PATH_PATTERNS) {
    if (pattern.test(path)) {
      return true;
    }
  }

  if (extraPatterns) {
    for (const pattern of extraPatterns) {
      if (pattern.test(path)) {
        return true;
      }
    }
  }

  return false;
}
