import { test, expect } from '@playwright/test';
import { ProjectConfigSchema, type AiPolicy } from '../../src/config/schema.js';
import { resolveAiRequestOptions, isAiEnabled } from '../../src/ai/resolve.js';

function baseConfigInput(aiOverride?: unknown) {
  return {
    schemaVersion: 1 as const,
    projectName: 'demo',
    baseUrl: 'https://example.com',
    allowedHosts: ['example.com'],
    pages: [{ path: '/' }],
    ...(aiOverride !== undefined ? { ai: aiOverride } : {})
  };
}

test.describe('AiPolicySchema defaults', () => {
  test('applies default limits when ai is omitted', () => {
    const config = ProjectConfigSchema.parse(baseConfigInput());
    expect(config.ai).toEqual({
      enabled: false,
      provider: 'none',
      timeoutMs: 30_000,
      maxOutputTokens: 1024,
      maxAttempts: 2,
      maxCostUsd: 0.5
    });
  });

  test('applies default limits when ai is an empty object', () => {
    const config = ProjectConfigSchema.parse(baseConfigInput({}));
    expect(config.ai.timeoutMs).toBe(30_000);
    expect(config.ai.maxOutputTokens).toBe(1024);
    expect(config.ai.maxAttempts).toBe(2);
    expect(config.ai.maxCostUsd).toBe(0.5);
  });

  test('explicit overrides win over defaults', () => {
    const config = ProjectConfigSchema.parse(
      baseConfigInput({ enabled: true, provider: 'anthropic', timeoutMs: 5_000, maxOutputTokens: 256, maxAttempts: 1, maxCostUsd: 0.1 })
    );
    expect(config.ai).toEqual({
      enabled: true,
      provider: 'anthropic',
      timeoutMs: 5_000,
      maxOutputTokens: 256,
      maxAttempts: 1,
      maxCostUsd: 0.1
    });
  });

  test('backwards compatible: a config with only { enabled, provider } still validates', () => {
    const config = ProjectConfigSchema.parse(baseConfigInput({ enabled: true, provider: 'none' }));
    expect(config.ai.enabled).toBe(true);
    expect(config.ai.provider).toBe('none');
    expect(config.ai.timeoutMs).toBe(30_000);
  });

  test('rejects an unknown ai key', () => {
    expect(() => ProjectConfigSchema.parse(baseConfigInput({ unknownField: 'PLACEHOLDER' }))).toThrow();
  });
});

function policy(overrides: Partial<AiPolicy> = {}): AiPolicy {
  return {
    enabled: false,
    provider: 'none',
    timeoutMs: 30_000,
    maxOutputTokens: 1024,
    maxAttempts: 2,
    maxCostUsd: 0.5,
    ...overrides
  };
}

test.describe('resolveAiRequestOptions', () => {
  test('returns the resolved limits from policy', () => {
    const options = resolveAiRequestOptions(policy({ timeoutMs: 9_000, maxOutputTokens: 512, maxAttempts: 3, maxCostUsd: 1.5 }));
    expect(options).toEqual({ timeoutMs: 9_000, maxOutputTokens: 512, maxAttempts: 3, maxCostUsd: 1.5 });
  });

  test('is pure: repeated calls with the same policy return equal results', () => {
    const p = policy();
    expect(resolveAiRequestOptions(p)).toEqual(resolveAiRequestOptions(p));
  });
});

test.describe('isAiEnabled', () => {
  test('false when disabled, regardless of provider', () => {
    expect(isAiEnabled(policy({ enabled: false, provider: 'anthropic' }))).toBe(false);
    expect(isAiEnabled(policy({ enabled: false, provider: 'none' }))).toBe(false);
  });

  test('false when enabled but provider is none', () => {
    expect(isAiEnabled(policy({ enabled: true, provider: 'none' }))).toBe(false);
  });

  test('true only when enabled AND provider is not none', () => {
    expect(isAiEnabled(policy({ enabled: true, provider: 'anthropic' }))).toBe(true);
  });
});
