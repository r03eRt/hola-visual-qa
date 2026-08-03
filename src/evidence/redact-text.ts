/**
 * SECURITY-CRITICAL free-text and URL redaction helpers for the evidence
 * bundle. Pure functions only — no fs/Date/random/env — so behavior is
 * fully deterministic and testable without a browser or network. See
 * docs/features/evidence-redaction/SPEC.md and
 * docs/security/SECURITY_AND_PRIVACY.md for the shapes that MUST never
 * reach an AI provider, a persisted artifact or a committed report.
 */

const REDACTED = '[REDACTED]';

/**
 * Ordered list of secret-shape patterns applied to free text. Order matters:
 * more specific shapes (bearer tokens, JWTs, provider API keys, header
 * lines) run before the generic `key=value` pair matcher so overlapping
 * text is not double-counted in a surprising way. Each pattern must be
 * conservative to avoid false positives on ordinary prose.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Authorization:/Cookie:/Set-Cookie: header lines — redact the value only.
  // Matched before the standalone Bearer pattern so an "Authorization:
  // Bearer <token>" line counts once, not twice.
  /\b(authorization|cookie|set-cookie|x[-_]api[-_]key|x[-_]auth[-_]token|api[-_]key|x[-_]access[-_]token)\s*:\s*[^\r\n]+/gi,
  // Bearer <token> occurring outside of a header line.
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  // JWTs: header.payload.signature, each segment base64url.
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Anthropic-style API keys.
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  // Stripe-style live secret keys.
  /\bsk_live_[A-Za-z0-9]{10,}/g,
  // OpenAI-style API keys (checked after sk-ant-/sk_live_ so those match first).
  /\bsk-[A-Za-z0-9]{16,}/g,
  // key=value or "key":"value" pairs for well-known secret field names,
  // including compound underscore/hyphen names (client_secret, refresh_token,
  // aws_secret_access_key, ...) that a plain \b-anchored base name would miss
  // because `_` is a word character. Longer names precede the base names they
  // contain so the alternation prefers the more specific match.
  /\b(aws[_-]secret[_-]access[_-]key|aws[_-]access[_-]key[_-]id|client[_-]secret|refresh[_-]token|access[_-]token|id[_-]token|private[_-]key|api[_-]?key|apikey|token|secret|passwo?rd|pwd|auth|session|signature|sig)\s*["']?\s*[:=]\s*["']?[^\s&"']+/gi
];

/**
 * Replaces every occurrence of a known secret shape in `text` with the
 * literal `[REDACTED]`, returning the redacted text and how many
 * replacements were made. Never throws on non-string-ish input.
 */
export function redactSecrets(text: string): { text: string; count: number } {
  let value = typeof text === 'string' ? text : String(text ?? '');
  let count = 0;

  for (const pattern of SECRET_PATTERNS) {
    value = value.replace(pattern, () => {
      count += 1;
      return REDACTED;
    });
  }

  return { text: value, count };
}

/**
 * Redacts the values of configured sensitive query parameters from `url`,
 * keeping benign params intact, and always strips the fragment. Falls back
 * to stripping everything from the first `?`/`#` when the URL cannot be
 * parsed (safe default). Never throws.
 */
export function redactUrlParams(url: string, sensitiveParams: readonly string[]): { url: string; count: number } {
  const source = typeof url === 'string' ? url : String(url ?? '');
  const sensitive = new Set(sensitiveParams.map((name) => name.toLowerCase()));

  try {
    const parsed = new URL(source);
    let count = 0;
    const uniqueKeys = new Set(parsed.searchParams.keys());

    for (const key of uniqueKeys) {
      if (sensitive.has(key.toLowerCase())) {
        const valueCount = parsed.searchParams.getAll(key).length;
        parsed.searchParams.delete(key);
        for (let i = 0; i < valueCount; i += 1) {
          count += 1;
          parsed.searchParams.append(key, 'REDACTED');
        }
      }
    }

    parsed.hash = '';
    const search = parsed.search;
    return { url: `${parsed.origin}${parsed.pathname}${search}`, count };
  } catch {
    const cutIndex = source.search(/[?#]/);
    return { url: cutIndex === -1 ? source : source.slice(0, cutIndex), count: 0 };
  }
}

/**
 * Cuts `text` to at most `maxChars` characters, appending a deterministic
 * `…[+N chars]` marker when truncation occurred. `maxChars < 0` is treated
 * as `0`.
 */
export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  const limit = Math.max(0, maxChars);

  if (text.length <= limit) {
    return { text, truncated: false };
  }

  const remaining = text.length - limit;
  return { text: `${text.slice(0, limit)}…[+${remaining} chars]`, truncated: true };
}
