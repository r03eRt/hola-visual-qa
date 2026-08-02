/**
 * Pure URL normalization for discovery. See
 * docs/features/url-sitemap-discovery/SPEC.md. Strips query and fragment
 * (so tokens/secrets in sitemap URLs never enter the inventory), lowercases
 * the host, collapses duplicate slashes and removes trailing slashes
 * (except root).
 */

export interface NormalizedUrl {
  /** Absolute normalized URL: protocol + lowercased host(+port) + path. */
  url: string;
  /** Lowercased hostname, without port — used for allowlist matching. */
  host: string;
  /** Normalized pathname, starts with '/'. */
  path: string;
}

function normalizePath(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, '/');
  if (collapsed === '/') {
    return collapsed;
  }
  return collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
}

/**
 * Parses and normalizes a raw URL string (optionally relative to
 * `baseUrl`). Only `http:`/`https:` protocols are accepted; anything else,
 * or input the `URL` constructor cannot parse, yields `null`.
 */
export function normalizeUrl(raw: string, baseUrl?: string): NormalizedUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(raw, baseUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const path = normalizePath(parsed.pathname);
  const host = parsed.hostname.toLowerCase();
  const url = `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;

  return { url, host, path };
}
