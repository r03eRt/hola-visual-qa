import { test, expect } from '@playwright/test';
import { normalizeUrl } from '../../src/discovery/normalize.js';

test.describe('normalizeUrl', () => {
  test('lowercases the host', () => {
    const result = normalizeUrl('https://Example.COM/Path');
    expect(result).not.toBeNull();
    expect(result?.host).toBe('example.com');
    expect(result?.url).toBe('https://example.com/Path');
  });

  test('strips query and fragment', () => {
    const result = normalizeUrl('https://example.com/page?x=1&y=2#section');
    expect(result).toEqual({ url: 'https://example.com/page', host: 'example.com', path: '/page' });
  });

  test('collapses duplicate slashes in the path', () => {
    const result = normalizeUrl('https://example.com//foo///bar');
    expect(result?.path).toBe('/foo/bar');
    expect(result?.url).toBe('https://example.com/foo/bar');
  });

  test('removes a trailing slash', () => {
    const result = normalizeUrl('https://example.com/foo/');
    expect(result?.path).toBe('/foo');
  });

  test('keeps the root path as "/"', () => {
    const result = normalizeUrl('https://example.com/');
    expect(result?.path).toBe('/');
    expect(result?.url).toBe('https://example.com/');
  });

  test('returns null for a non-http(s) protocol', () => {
    expect(normalizeUrl('ftp://example.com/file')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('mailto:someone@example.com')).toBeNull();
  });

  test('returns null for unparseable input', () => {
    expect(normalizeUrl('not a url at all')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });

  test('resolves a relative path against baseUrl', () => {
    const result = normalizeUrl('/relative/path', 'https://example.com');
    expect(result).toEqual({
      url: 'https://example.com/relative/path',
      host: 'example.com',
      path: '/relative/path'
    });
  });

  test('is deterministic across repeated calls', () => {
    const first = normalizeUrl('https://Example.com//a//b/?q=1');
    const second = normalizeUrl('https://Example.com//a//b/?q=1');
    expect(first).toEqual(second);
  });
});
