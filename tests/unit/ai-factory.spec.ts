import { test, expect } from '@playwright/test';
import { createAiProvider } from '../../src/ai/factory.js';
import { DisabledAiProvider } from '../../src/ai/disabled-provider.js';
import { AnthropicProvider } from '../../src/ai/anthropic/provider.js';
import type { AnthropicMessagesClient } from '../../src/ai/anthropic/client-port.js';
import { ProjectConfigSchema, type AiPolicy } from '../../src/config/schema.js';

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

function aiPolicy(override?: unknown): AiPolicy {
  return ProjectConfigSchema.parse(baseConfigInput(override)).ai;
}

const fakeClient: AnthropicMessagesClient = {
  async createMessage() {
    return { text: '{}' };
  }
};

test.describe('createAiProvider', () => {
  test('returns DisabledAiProvider when ai is disabled', () => {
    const provider = createAiProvider(aiPolicy({ enabled: false, provider: 'anthropic' }));
    expect(provider).toBeInstanceOf(DisabledAiProvider);
    expect(provider.name).toBe('none');
  });

  test('returns DisabledAiProvider when provider is "none"', () => {
    const provider = createAiProvider(aiPolicy({ enabled: true, provider: 'none' }));
    expect(provider).toBeInstanceOf(DisabledAiProvider);
  });

  test('returns an AnthropicProvider when enabled + anthropic, using injected deps', () => {
    const provider = createAiProvider(aiPolicy({ enabled: true, provider: 'anthropic' }), {
      client: fakeClient,
      model: 'claude-test-model',
      apiKey: 'test-key'
    });

    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe('anthropic');
  });

  test('resolves the model from the policy when no override is injected', () => {
    const provider = createAiProvider(aiPolicy({ enabled: true, provider: 'anthropic', model: 'claude-from-policy' }), {
      client: fakeClient,
      apiKey: 'test-key'
    });

    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  test('throws a normalized error when enabled + anthropic but no model is resolvable', () => {
    expect(() =>
      createAiProvider(aiPolicy({ enabled: true, provider: 'anthropic' }), { client: fakeClient, apiKey: 'test-key' })
    ).toThrow(/model/i);
  });

  test('throws a normalized error when enabled + anthropic but no api key is resolvable', () => {
    expect(() => createAiProvider(aiPolicy({ enabled: true, provider: 'anthropic', model: 'claude-test-model' }))).toThrow(
      /ANTHROPIC_API_KEY/i
    );
  });
});
