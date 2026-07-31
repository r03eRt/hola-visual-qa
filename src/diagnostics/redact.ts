/**
 * SECURITY-CRITICAL redaction helpers used by the diagnostics collector.
 * Pure functions only — no fs/Date/random/env — so behavior is fully
 * deterministic and testable without a browser.
 */

/**
 * Header names dropped entirely (case-insensitively) because they can carry
 * credentials/session tokens. The whole header is removed rather than
 * masked so no length/shape signal leaks into stored diagnostics.
 */
const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'authentication'
]);

/**
 * Returns a new headers object with sensitive keys dropped entirely
 * (case-insensitive match), preserving the order and values of all other
 * headers unchanged.
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) continue;
    redacted[key] = value;
  }
  return redacted;
}

/**
 * Strips the query string and fragment from a URL (they can carry tokens).
 * Returns `origin + pathname` when the URL is parseable; falls back to the
 * substring before the first `?`/`#` otherwise. Never throws.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    const cutIndex = url.search(/[?#]/);
    return cutIndex === -1 ? url : url.slice(0, cutIndex);
  }
}
