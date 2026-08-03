import { test, expect } from '@playwright/test';
import { parseAnalysisResponse } from '../../src/ai/anthropic/parse.js';
import { AiProviderError } from '../../src/ai/contract.js';
import { RedactedEvidenceSchema, type RedactedEvidence } from '../../src/evidence/contract.js';
import type { Scenario } from '../../src/domain/result.js';

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
    errors: [],
    failedChecks: ['console_error: a console error occurred'],
    console: [],
    network: [],
    redactionNotes: {
      secretsRedacted: 3,
      urlParamsRedacted: 4,
      truncatedFields: 5,
      droppedConsole: 6,
      droppedNetwork: 7,
      droppedErrors: 8
    }
  });
}

const validAnalysisJson = {
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
};

test.describe('parseAnalysisResponse', () => {
  test('parses a plain JSON object', () => {
    const result = parseAnalysisResponse(JSON.stringify(validAnalysisJson), evidence());

    expect(result.summary).toBe('A likely UI regression');
    expect(result.severitySuggestion).toBe('medium');
  });

  test('parses a JSON object wrapped in a fenced code block with surrounding prose', () => {
    const text = `Here is my analysis:\n\`\`\`json\n${JSON.stringify(validAnalysisJson)}\n\`\`\`\nLet me know if useful.`;

    const result = parseAnalysisResponse(text, evidence());

    expect(result.summary).toBe('A likely UI regression');
  });

  test('always overrides redactionNotes with the evidence value, even if the model lies', () => {
    const result = parseAnalysisResponse(JSON.stringify(validAnalysisJson), evidence());

    expect(result.redactionNotes).toEqual(evidence().redactionNotes);
    expect(result.redactionNotes).not.toEqual(validAnalysisJson.redactionNotes);
  });

  test('throws AiProviderError when there is no JSON object at all', () => {
    expect(() => parseAnalysisResponse('not json at all', evidence())).toThrow(AiProviderError);
  });

  test('throws AiProviderError on malformed JSON', () => {
    expect(() => parseAnalysisResponse('{ "summary": "unterminated', evidence())).toThrow(AiProviderError);
  });

  test('throws AiProviderError when the JSON does not match AiAnalysisSchema', () => {
    const invalid = JSON.stringify({ summary: 'ok' });

    expect(() => parseAnalysisResponse(invalid, evidence())).toThrow(AiProviderError);
  });

  test('the thrown error never echoes the raw model text or evidence', () => {
    const distinctiveMarker = 'DISTINCTIVE_MODEL_TEXT_MARKER';

    try {
      parseAnalysisResponse(`prose without json ${distinctiveMarker}`, evidence());
      throw new Error('expected parseAnalysisResponse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderError);
      const providerError = error as AiProviderError;
      expect(providerError.message).not.toContain(distinctiveMarker);
    }
  });
});
