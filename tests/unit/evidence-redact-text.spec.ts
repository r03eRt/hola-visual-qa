import { test, expect } from '@playwright/test';
import { redactSecrets, redactUrlParams, truncate } from '../../src/evidence/redact-text.js';

// Secret-provider prefixes are assembled from fragments so the raw source of
// this test never contains a contiguous real-looking credential (which would
// trip secret scanners) while still exercising the redaction patterns.
const SK = 's' + 'k';
const ANTHROPIC_KEY = `${SK}-ant-abcdefghij1234567890`;
const OPENAI_KEY = `${SK}-1234567890abcdef1234567890`;
const STRIPE_KEY = `${SK}_live_abcdefghij1234`;

test.describe('redactSecrets', () => {
  test('redacts a bearer token in an authorization header line', () => {
    const result = redactSecrets('Authorization: ' + 'Bearer ' + 'PLACEHOLDER');
    expect(result.text).toBe('[REDACTED]');
    expect(result.count).toBe(1);
  });

  test('redacts a standalone Bearer token outside a header line', () => {
    const result = redactSecrets('sent header ' + 'Bearer ' + 'PLACEHOLDER' + ' to upstream');
    expect(result.text).toBe('sent header [REDACTED] to upstream');
    expect(result.count).toBe(1);
  });

  test('redacts a JWT', () => {
    const jwt = 'eyJ'.concat('hbGciOiJIUzI1NiJ9') + '.payloadSegment0' + '.signatureSegment0';
    const result = redactSecrets(`token seen: ${jwt}`);
    expect(result.text).toBe('token seen: [REDACTED]');
    expect(result.count).toBe(1);
  });

  test('redacts Anthropic-style API keys', () => {
    const result = redactSecrets(`key=${ANTHROPIC_KEY}`);
    expect(result.text).not.toContain('ant-abcdefghij');
    expect(result.count).toBeGreaterThan(0);
  });

  test('redacts OpenAI-style API keys', () => {
    const result = redactSecrets(`using ${OPENAI_KEY} now`);
    expect(result.text).toBe('using [REDACTED] now');
    expect(result.count).toBe(1);
  });

  test('redacts Stripe-style live secret keys', () => {
    const result = redactSecrets(STRIPE_KEY);
    expect(result.text).toBe('[REDACTED]');
    expect(result.count).toBe(1);
  });

  test('redacts a Cookie header line value', () => {
    const result = redactSecrets('Cookie: ' + 'session=PLACEHOLDER_D; other=val2');
    expect(result.text).toBe('[REDACTED]');
    expect(result.count).toBe(1);
  });

  test('redacts a Set-Cookie header line value', () => {
    const result = redactSecrets('Set-Cookie: ' + 'session=PLACEHOLDER_E; Path=/; HttpOnly');
    expect(result.text).toBe('[REDACTED]');
    expect(result.count).toBe(1);
  });

  test('redacts generic credential key/value pairs', () => {
    const pw = 'pass' + 'word';
    const result = redactSecrets(`token=PLACEHOLDER_A and ${pw}: PLACEHOLDER_B`);
    expect(result.text).not.toContain('PLACEHOLDER_A');
    expect(result.text).not.toContain('PLACEHOLDER_B');
    expect(result.count).toBe(2);
  });

  test('redacts JSON-ish "api_key":"value" pairs', () => {
    const result = redactSecrets('{"api_key":"PLACEHOLDER_C"}');
    expect(result.text).not.toContain('PLACEHOLDER_C');
    expect(result.count).toBe(1);
  });

  test('redacts compound underscore/hyphen secret field names (regression)', () => {
    const opaque = 'REDACTMEplaceholder0000';
    const samples = [
      `client_secret=${opaque}`,
      `refresh_token=${opaque}`,
      `aws_secret_access_key=${opaque}`,
      `aws_access_key_id=${opaque}`,
      `private_key: ${opaque}`
    ];
    for (const sample of samples) {
      const result = redactSecrets(sample);
      const secret = sample.split(/[:=]/)[1]!.trim();
      expect(result.text, sample).not.toContain(secret);
      expect(result.count, sample).toBeGreaterThan(0);
    }
  });

  test('redacts hyphenated credential header lines (regression)', () => {
    for (const line of ['X-Api-Key: PLACEHOLDER_F', 'X-Auth-Token: PLACEHOLDER_G']) {
      const result = redactSecrets(line);
      expect(result.text, line).toBe('[REDACTED]');
      expect(result.count, line).toBe(1);
    }
  });

  test('leaves ordinary prose untouched', () => {
    const prose = 'This is just ordinary prose about tokens and passwords in general.';
    const result = redactSecrets(prose);
    expect(result.text).toBe(prose);
    expect(result.count).toBe(0);
  });

  test('never throws on non-string-ish input', () => {
    expect(() => redactSecrets(null as unknown as string)).not.toThrow();
    expect(() => redactSecrets(undefined as unknown as string)).not.toThrow();
    expect(() => redactSecrets(42 as unknown as string)).not.toThrow();
  });
});

test.describe('redactUrlParams', () => {
  test('keeps benign query params untouched', () => {
    const result = redactUrlParams('https://example.com/path?a=1&b=2', ['token']);
    expect(result.url).toBe('https://example.com/path?a=1&b=2');
    expect(result.count).toBe(0);
  });

  test('replaces sensitive param values with REDACTED and keeps others', () => {
    const result = redactUrlParams('https://example.com/path?a=1&token=SECRET&b=2', ['token']);
    expect(result.url).toBe('https://example.com/path?a=1&b=2&token=REDACTED');
    expect(result.url).not.toContain('SECRET');
    expect(result.count).toBe(1);
  });

  test('matches sensitive param names case-insensitively', () => {
    const result = redactUrlParams('https://example.com/path?Token=SECRET', ['token']);
    expect(result.url).not.toContain('SECRET');
    expect(result.count).toBe(1);
  });

  test('always strips the fragment', () => {
    const result = redactUrlParams('https://example.com/path?a=1#some-fragment', ['token']);
    expect(result.url).toBe('https://example.com/path?a=1');
  });

  test('falls back to stripping query+fragment for unparseable input without throwing', () => {
    const result = redactUrlParams('/relative/path?token=SECRET#frag', ['token']);
    expect(result.url).toBe('/relative/path');
    expect(result.count).toBe(0);
    expect(() => redactUrlParams('not a url at all', ['token'])).not.toThrow();
  });

  test('counts every redacted value, including repeated param names', () => {
    const result = redactUrlParams('https://example.com/path?token=aaa111&token=bbb222', ['token']);
    expect(result.count).toBe(2);
    expect(result.url).not.toContain('aaa111');
    expect(result.url).not.toContain('bbb222');
  });
});

test.describe('truncate', () => {
  test('returns text unchanged when under the limit', () => {
    const result = truncate('hello', 10);
    expect(result).toEqual({ text: 'hello', truncated: false });
  });

  test('returns text unchanged when exactly at the limit', () => {
    const result = truncate('hello', 5);
    expect(result).toEqual({ text: 'hello', truncated: false });
  });

  test('cuts and appends a deterministic marker when over the limit', () => {
    const result = truncate('hello world', 5);
    expect(result.text).toBe('hello…[+6 chars]');
    expect(result.truncated).toBe(true);
  });

  test('treats a negative maxChars as zero', () => {
    const result = truncate('hello', -5);
    expect(result.text).toBe('…[+5 chars]');
    expect(result.truncated).toBe(true);
  });
});
