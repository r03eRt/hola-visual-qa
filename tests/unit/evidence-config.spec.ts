import { test, expect } from '@playwright/test';
import { ProjectConfigSchema, resolveEvidencePolicy } from '../../src/config/schema.js';

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    adapters: { consent: {}, ads: {}, country: {}, user: { fixtures: [] } },
    visual: { maxDiffPixelRatio: 0.01, animations: 'disabled', maskSelectors: ['[data-visual-mask]'] },
    diagnostics: { captureConsole: true, captureNetwork: true, ignoredDomains: [] },
    artifacts: { outputDir: 'reports', retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none' },
    execution: { retries: 0 },
    ...overrides
  };
}

test.describe('EvidencePolicy config', () => {
  test('ProjectConfig stays valid when evidence is omitted', () => {
    const config = ProjectConfigSchema.parse(baseConfig());
    expect(config.evidence).toBeUndefined();
  });

  test('resolveEvidencePolicy returns fully-defaulted policy when evidence is omitted', () => {
    const config = ProjectConfigSchema.parse(baseConfig());
    const policy = resolveEvidencePolicy(config);

    expect(policy.maxConsoleEntries).toBe(50);
    expect(policy.maxNetworkEntries).toBe(50);
    expect(policy.maxErrors).toBe(20);
    expect(policy.maxFieldChars).toBe(2000);
    expect(policy.includeImages).toBe(true);
    expect(policy.includeResponseBodies).toBe(false);
    expect(policy.sensitiveQueryParams).toContain('token');
  });

  test('EvidencePolicySchema (via ProjectConfig) rejects an unknown key', () => {
    const config = baseConfig({ evidence: { maxConsoleEntries: 10, bogus: true } as never });
    expect(() => ProjectConfigSchema.parse(config)).toThrow();
  });

  test('a partial evidence policy merges with defaults', () => {
    const config = ProjectConfigSchema.parse(baseConfig({ evidence: { maxConsoleEntries: 5 } }));
    const policy = resolveEvidencePolicy(config);

    expect(policy.maxConsoleEntries).toBe(5);
    expect(policy.maxNetworkEntries).toBe(50);
    expect(policy.includeResponseBodies).toBe(false);
  });
});
