import { test, expect } from '@playwright/test';
import { RedactedEvidenceSchema, type RedactedEvidence } from '../../src/evidence/contract.js';
import { DisabledAiProvider } from '../../src/ai/disabled-provider.js';
import { AiProviderError, type AiAnalysisRequest, type AiProvider, type AiRequestOptions } from '../../src/ai/contract.js';
import type { AiAnalysis } from '../../src/ai/analysis.js';
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

function evidence(): RedactedEvidence {
  return RedactedEvidenceSchema.parse({
    scenario: scenario(),
    status: 'failed',
    errors: [
      {
        code: 'console_error.assertion',
        category: 'console_error',
        message: 'a console error occurred',
        severity: 'error'
      }
    ],
    failedChecks: ['console_error: a console error occurred'],
    console: [{ type: 'error', text: `console leak marker: ${DISTINCTIVE_CONSOLE_MARKER}` }],
    network: [{ url: `https://example.com/api?ok=1&marker=${DISTINCTIVE_URL_MARKER}`, method: 'GET', status: 500 }],
    artifacts: { expected: 'expected.png', actual: 'actual.png', diff: 'diff.png' },
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

function options(): AiRequestOptions {
  return { timeoutMs: 30_000, maxOutputTokens: 1024, maxAttempts: 2, maxCostUsd: 0.5 };
}

test.describe('DisabledAiProvider', () => {
  test('has name "none"', () => {
    expect(new DisabledAiProvider().name).toBe('none');
  });

  test('analyze() rejects with a normalized AiProviderError', async () => {
    const provider = new DisabledAiProvider();
    const request: AiAnalysisRequest = { evidence: evidence(), options: options() };

    await expect(provider.analyze(request)).rejects.toBeInstanceOf(AiProviderError);
  });

  test('the rejection message never contains any distinctive evidence value', async () => {
    const provider = new DisabledAiProvider();
    const request: AiAnalysisRequest = { evidence: evidence(), options: options() };

    try {
      await provider.analyze(request);
      throw new Error('expected analyze() to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderError);
      const providerError = error as AiProviderError;
      expect(providerError.message).not.toContain(DISTINCTIVE_URL_MARKER);
      expect(providerError.message).not.toContain(DISTINCTIVE_CONSOLE_MARKER);
      expect(providerError.category).toBe('ai_provider_error');
      expect(providerError.normalized.severity).toBe('warning');
    }
  });
});

// A tiny fake provider that proves the `AiProvider` port shape compiles and
// consumes a `RedactedEvidence` value end to end (no network involved).
class FakeAiProvider implements AiProvider {
  readonly name = 'fake';

  async analyze(request: AiAnalysisRequest): Promise<AiAnalysis> {
    return Promise.resolve({
      summary: `Analyzed scenario ${request.evidence.scenario.id}`,
      severitySuggestion: 'low',
      observedEvidence: request.evidence.failedChecks,
      hypotheses: ['A plausible cause, not a conclusion'],
      recommendedInvestigationSteps: ['Inspect the diff image'],
      confidence: 'low',
      redactionNotes: request.evidence.redactionNotes
    });
  }
}

test.describe('AiProvider port shape', () => {
  test('a fake provider can consume RedactedEvidence and resolve an AiAnalysis', async () => {
    const provider = new FakeAiProvider();
    const request: AiAnalysisRequest = { evidence: evidence(), options: options() };

    const result = await provider.analyze(request);

    expect(result.summary).toContain('home-desktop-accepted-es-ads');
    expect(result.observedEvidence).toEqual(request.evidence.failedChecks);
  });
});
