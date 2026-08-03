import { test, expect } from '@playwright/test';
import { AiAnalysisSchema, type AiAnalysis } from '../../src/ai/analysis.js';
import type { RedactionNotes } from '../../src/evidence/contract.js';

function redactionNotes(overrides: Partial<RedactionNotes> = {}): RedactionNotes {
  return {
    secretsRedacted: 0,
    urlParamsRedacted: 0,
    truncatedFields: 0,
    droppedConsole: 0,
    droppedNetwork: 0,
    droppedErrors: 0,
    ...overrides
  };
}

function analysis(overrides: Partial<AiAnalysis> = {}): AiAnalysis {
  return {
    summary: 'The visual diff appears in the header region.',
    severitySuggestion: 'medium',
    observedEvidence: ['1 failed check: visual_regression'],
    hypotheses: ['A recent CSS change may have shifted the header layout'],
    recommendedInvestigationSteps: ['Compare the diff image against the last approved baseline'],
    confidence: 'medium',
    redactionNotes: redactionNotes(),
    ...overrides
  };
}

test.describe('AiAnalysisSchema', () => {
  test('parses a well-formed analysis', () => {
    expect(() => AiAnalysisSchema.parse(analysis())).not.toThrow();
  });

  test('rejects an unknown top-level key', () => {
    const withExtra = { ...analysis(), extraField: 'PLACEHOLDER' };
    expect(() => AiAnalysisSchema.parse(withExtra)).toThrow();
  });

  test.describe('rejects secret-looking keys', () => {
    for (const key of ['apiKey', 'authorization', 'token']) {
      test(`rejects "${key}"`, () => {
        const withSecret = { ...analysis(), [key]: 'PLACEHOLDER' } as unknown;
        expect(() => AiAnalysisSchema.parse(withSecret)).toThrow();
      });
    }
  });

  test('rejects an invalid severitySuggestion enum value', () => {
    const invalid = { ...analysis(), severitySuggestion: 'critical' };
    expect(() => AiAnalysisSchema.parse(invalid)).toThrow();
  });

  test('rejects an invalid confidence enum value', () => {
    const invalid = { ...analysis(), confidence: 'certain' };
    expect(() => AiAnalysisSchema.parse(invalid)).toThrow();
  });

  test('requires redactionNotes', () => {
    const withoutNotes: Partial<AiAnalysis> = analysis();
    delete withoutNotes.redactionNotes;
    expect(() => AiAnalysisSchema.parse(withoutNotes)).toThrow();
  });
});
