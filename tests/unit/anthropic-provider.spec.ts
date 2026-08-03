import { test, expect } from '@playwright/test';
import {
  AnthropicProvider,
  ANTHROPIC_INPUT_PRICE_PER_TOKEN_USD,
  ANTHROPIC_OUTPUT_PRICE_PER_TOKEN_USD
} from '../../src/ai/anthropic/provider.js';
import type {
  AnthropicMessageParams,
  AnthropicMessageResult,
  AnthropicMessagesClient
} from '../../src/ai/anthropic/client-port.js';
import type { ImageLoader } from '../../src/ai/anthropic/image-port.js';
import { AiProviderError, type AiAnalysisRequest, type AiRequestOptions } from '../../src/ai/contract.js';
import { RedactedEvidenceSchema, type RedactedEvidence } from '../../src/evidence/contract.js';
import type { Scenario } from '../../src/domain/result.js';

const DISTINCTIVE_URL_MARKER = 'DISTINCTIVE_EVIDENCE_MARKER_URL';
const DISTINCTIVE_CONSOLE_MARKER = 'DISTINCTIVE_EVIDENCE_MARKER_CONSOLE';

function scenario(): Scenario {
  return {
    id: 'home-desktop-accepted-es-ads',
    page: { path: '/' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true
  };
}

function evidence(withArtifacts = false): RedactedEvidence {
  return RedactedEvidenceSchema.parse({
    scenario: scenario(),
    status: 'failed',
    errors: [],
    failedChecks: ['console_error: a console error occurred'],
    console: [{ type: 'error', text: `console leak marker: ${DISTINCTIVE_CONSOLE_MARKER}` }],
    network: [{ url: `https://example.com/api?marker=${DISTINCTIVE_URL_MARKER}`, method: 'GET', status: 500 }],
    ...(withArtifacts ? { artifacts: { expected: 'expected.png', actual: 'actual.png', diff: 'diff.png' } } : {}),
    redactionNotes: {
      secretsRedacted: 0,
      urlParamsRedacted: 0,
      truncatedFields: 0,
      droppedConsole: 0,
      droppedNetwork: 0,
      droppedErrors: 0
    }
  });
}

function options(overrides?: Partial<AiRequestOptions>): AiRequestOptions {
  return { timeoutMs: 200, maxOutputTokens: 1024, maxAttempts: 2, maxCostUsd: 0.5, ...overrides };
}

const validAnalysisText = JSON.stringify({
  summary: 'A likely UI regression',
  severitySuggestion: 'medium',
  observedEvidence: ['console error observed'],
  hypotheses: ['Possibly a CSS regression'],
  recommendedInvestigationSteps: ['Inspect the diff image'],
  confidence: 'medium',
  redactionNotes: {
    secretsRedacted: 0,
    urlParamsRedacted: 0,
    truncatedFields: 0,
    droppedConsole: 0,
    droppedNetwork: 0,
    droppedErrors: 0
  }
});

function fakeClient(
  handler: (params: AnthropicMessageParams, signal?: AbortSignal) => Promise<AnthropicMessageResult>
): AnthropicMessagesClient {
  return { createMessage: handler };
}

test.describe('AnthropicProvider', () => {
  test('happy path resolves a schema-valid AiAnalysis', async () => {
    const client = fakeClient(async () => ({ text: validAnalysisText }));
    const provider = new AnthropicProvider({ client, model: 'claude-test-model' });

    const request: AiAnalysisRequest = { evidence: evidence(), options: options() };
    const result = await provider.analyze(request);

    expect(result.summary).toBe('A likely UI regression');
    expect(result.redactionNotes).toEqual(evidence().redactionNotes);
  });

  test('a hanging client times out with an AiProviderError', async () => {
    const client = fakeClient(() => new Promise<AnthropicMessageResult>(() => {}));
    const provider = new AnthropicProvider({ client, model: 'claude-test-model' });

    const request: AiAnalysisRequest = { evidence: evidence(), options: options({ timeoutMs: 50, maxAttempts: 1 }) };

    await expect(provider.analyze(request)).rejects.toThrow(/timed out/i);
  });

  test('retries once and succeeds on the second attempt', async () => {
    let attempts = 0;
    const client = fakeClient(async () => {
      attempts++;
      if (attempts === 1) throw new Error('transient failure');
      return { text: validAnalysisText };
    });
    const provider = new AnthropicProvider({ client, model: 'claude-test-model' });

    const request: AiAnalysisRequest = { evidence: evidence(), options: options({ maxAttempts: 2 }) };
    const result = await provider.analyze(request);

    expect(attempts).toBe(2);
    expect(result.summary).toBe('A likely UI regression');
  });

  test('throws AiProviderError once retries are exhausted', async () => {
    let attempts = 0;
    const client = fakeClient(async () => {
      attempts++;
      throw new Error('permanent failure');
    });
    const provider = new AnthropicProvider({ client, model: 'claude-test-model' });

    const request: AiAnalysisRequest = { evidence: evidence(), options: options({ maxAttempts: 3 }) };

    await expect(provider.analyze(request)).rejects.toBeInstanceOf(AiProviderError);
    expect(attempts).toBe(3);
  });

  test('attaches an image only when the loader returns bytes', async () => {
    let capturedContent: AnthropicMessageParams['content'] = [];
    const client = fakeClient(async params => {
      capturedContent = params.content;
      return { text: validAnalysisText };
    });

    const imageLoader: ImageLoader = {
      async load(ref: string) {
        if (ref === 'actual.png') return { base64: 'aGVsbG8=', mediaType: 'image/png' };
        return null;
      }
    };

    const provider = new AnthropicProvider({ client, model: 'claude-test-model', imageLoader });
    const request: AiAnalysisRequest = { evidence: evidence(true), options: options() };

    await provider.analyze(request);

    const imageBlocks = capturedContent.filter(block => block.type === 'image');
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]).toMatchObject({ base64: 'aGVsbG8=', mediaType: 'image/png' });
  });

  test('does no image attachment when there is no imageLoader', async () => {
    let capturedContent: AnthropicMessageParams['content'] = [];
    const client = fakeClient(async params => {
      capturedContent = params.content;
      return { text: validAnalysisText };
    });

    const provider = new AnthropicProvider({ client, model: 'claude-test-model' });
    const request: AiAnalysisRequest = { evidence: evidence(true), options: options() };

    await provider.analyze(request);

    expect(capturedContent.filter(block => block.type === 'image')).toHaveLength(0);
  });

  test('the error path never echoes evidence values', async () => {
    const client = fakeClient(async () => {
      throw new Error('permanent failure');
    });
    const provider = new AnthropicProvider({ client, model: 'claude-test-model' });

    const request: AiAnalysisRequest = { evidence: evidence(), options: options({ maxAttempts: 1 }) };

    try {
      await provider.analyze(request);
      throw new Error('expected analyze() to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderError);
      const providerError = error as AiProviderError;
      expect(providerError.message).not.toContain(DISTINCTIVE_URL_MARKER);
      expect(providerError.message).not.toContain(DISTINCTIVE_CONSOLE_MARKER);
    }
  });

  test('the cost guard trips when reported usage exceeds maxCostUsd', async () => {
    const hugeUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const estimatedCost = hugeUsage.inputTokens * ANTHROPIC_INPUT_PRICE_PER_TOKEN_USD + hugeUsage.outputTokens * ANTHROPIC_OUTPUT_PRICE_PER_TOKEN_USD;
    expect(estimatedCost).toBeGreaterThan(0.5);

    const client = fakeClient(async () => ({ text: validAnalysisText, usage: hugeUsage }));
    const provider = new AnthropicProvider({ client, model: 'claude-test-model' });

    const request: AiAnalysisRequest = { evidence: evidence(), options: options({ maxAttempts: 1, maxCostUsd: 0.5 }) };

    await expect(provider.analyze(request)).rejects.toThrow(/cost budget/i);
  });
});
