import { test, expect } from '@playwright/test';
import { buildRunManifest } from '../../src/artifacts/manifest.js';
import { RunManifestSchema, parseRunManifest } from '../../src/domain/index.js';
import type { ProjectConfig } from '../../src/config/schema.js';

// Mirrors the validConfig() fixture in tests/unit/artifacts.spec.ts.
function validConfig(): ProjectConfig {
  return {
    schemaVersion: 1,
    projectName: 'hola-visual-qa',
    baseUrl: 'https://example.com',
    allowedHosts: ['example.com'],
    pages: [{ path: '/' }],
    dimensions: {
      device: ['desktop', 'mobile'],
      consent: ['accepted', 'rejected'],
      country: ['ES'],
      ads: [true, false]
    },
    adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'none' }, user: { fixtures: [] } },
    visual: { maxDiffPixelRatio: 0.01, animations: 'disabled', maskSelectors: ['[data-visual-mask]'] },
    diagnostics: { captureConsole: true, captureNetwork: true, ignoredDomains: [] },
    artifacts: { outputDir: 'reports', retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none', timeoutMs: 30_000, maxOutputTokens: 1024, maxAttempts: 2, maxCostUsd: 0.5 },
    execution: { retries: 0 }
  } as ProjectConfig;
}

test.describe('RunManifest inventory field', () => {
  test('buildRunManifest omits inventory when not provided', () => {
    const manifest = buildRunManifest({
      os: 'darwin arm64',
      browser: { name: 'chromium', version: '120.0' },
      config: validConfig(),
      scenarioIds: []
    });
    expect(manifest.inventory).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(manifest, 'inventory')).toBe(false);
    expect(parseRunManifest(manifest)).toEqual(manifest);
  });

  test('buildRunManifest includes inventory when provided', () => {
    const inventory = {
      source: 'sitemap' as const,
      pages: [{ path: '/', url: 'https://example.com/' }]
    };
    const manifest = buildRunManifest({
      os: 'darwin arm64',
      browser: { name: 'chromium', version: '120.0' },
      config: validConfig(),
      scenarioIds: [],
      inventory
    });
    expect(manifest.inventory).toEqual(inventory);
    expect(parseRunManifest(manifest)).toEqual(manifest);
  });

  test('RunManifestSchema accepts a manifest without inventory', () => {
    const result = RunManifestSchema.safeParse({
      toolVersion: '0.1.0',
      os: 'darwin arm64',
      browser: { name: 'chromium', version: '120.0' },
      configHash: 'a'.repeat(64),
      scenarioIds: [],
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    expect(result.success).toBe(true);
  });

  test('RunManifestSchema accepts a manifest with inventory', () => {
    const result = RunManifestSchema.safeParse({
      toolVersion: '0.1.0',
      os: 'darwin arm64',
      browser: { name: 'chromium', version: '120.0' },
      configHash: 'a'.repeat(64),
      scenarioIds: [],
      inventory: { source: 'sitemap', pages: [{ path: '/', url: 'https://example.com/' }] },
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    expect(result.success).toBe(true);
  });

  test('RunManifestSchema still rejects a secret-looking top-level field', () => {
    const result = RunManifestSchema.safeParse({
      toolVersion: '0.1.0',
      os: 'darwin arm64',
      browser: { name: 'chromium', version: '120.0' },
      configHash: 'a'.repeat(64),
      scenarioIds: [],
      apiKey: 'shh',
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    expect(result.success).toBe(false);
  });
});
