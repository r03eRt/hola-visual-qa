import { test, expect } from '@playwright/test';
import { ProjectConfigSchema } from '../../src/config/schema.js';

function baseConfig(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectName: 'hola-visual-qa',
    baseUrl: 'https://example.com',
    allowedHosts: ['example.com'],
    pages: [{ path: '/' }]
  };
}

test.describe('ProjectConfigSchema discovery policy', () => {
  test('parses successfully when discovery is omitted', () => {
    const result = ProjectConfigSchema.safeParse(baseConfig());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discovery).toBeUndefined();
    }
  });

  test('parses discovery: {} to documented defaults', () => {
    const result = ProjectConfigSchema.safeParse({ ...baseConfig(), discovery: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discovery).toEqual({ maxUrls: 200, ignorePathPatterns: [] });
    }
  });

  test('accepts a fully-specified discovery policy', () => {
    const result = ProjectConfigSchema.safeParse({
      ...baseConfig(),
      discovery: {
        sitemapUrl: 'https://example.com/sitemap.xml',
        maxUrls: 50,
        ignorePathPatterns: ['/promo']
      }
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discovery).toEqual({
        sitemapUrl: 'https://example.com/sitemap.xml',
        maxUrls: 50,
        ignorePathPatterns: ['/promo']
      });
    }
  });

  test('rejects an unknown key inside discovery (.strict())', () => {
    const result = ProjectConfigSchema.safeParse({
      ...baseConfig(),
      discovery: { unexpectedField: true }
    });
    expect(result.success).toBe(false);
  });

  test('rejects an invalid sitemapUrl', () => {
    const result = ProjectConfigSchema.safeParse({
      ...baseConfig(),
      discovery: { sitemapUrl: 'not-a-url' }
    });
    expect(result.success).toBe(false);
  });

  test('rejects maxUrls below 1', () => {
    const result = ProjectConfigSchema.safeParse({
      ...baseConfig(),
      discovery: { maxUrls: 0 }
    });
    expect(result.success).toBe(false);
  });
});
