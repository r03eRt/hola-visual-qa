import { test, expect } from '@playwright/test';
import { buildAnalysisPrompt } from '../../src/ai/anthropic/prompt.js';
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

function evidence(overrides?: Partial<RedactedEvidence>): RedactedEvidence {
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
    console: [{ type: 'error', text: 'PLACEHOLDER console text' }],
    network: [{ url: 'https://example.com/api?ok=1', method: 'GET', status: 500 }],
    redactionNotes: {
      secretsRedacted: 1,
      urlParamsRedacted: 2,
      truncatedFields: 0,
      droppedConsole: 0,
      droppedNetwork: 0,
      droppedErrors: 0
    },
    ...overrides
  });
}

test.describe('buildAnalysisPrompt', () => {
  test('renders the scenario id, status and failed checks', () => {
    const { userText } = buildAnalysisPrompt(evidence());

    expect(userText).toContain('home-desktop-accepted-es-ads');
    expect(userText).toContain('failed');
    expect(userText).toContain('console_error: a console error occurred');
  });

  test('renders redaction notes counts', () => {
    const { userText } = buildAnalysisPrompt(evidence());

    expect(userText).toContain('secretsRedacted=1');
    expect(userText).toContain('urlParamsRedacted=2');
  });

  test('renders console and network entries', () => {
    const { userText } = buildAnalysisPrompt(evidence());

    expect(userText).toContain('PLACEHOLDER console text');
    expect(userText).toContain('GET https://example.com/api?ok=1 -> 500');
  });

  test('the system prompt requires strict JSON and never requests pass/fail decisions or more data', () => {
    const { system } = buildAnalysisPrompt(evidence());

    expect(system).toMatch(/strict json/i);
    expect(system).toMatch(/never decide pass\/fail/i);
    expect(system).toMatch(/never ask for more data/i);
    expect(system).toMatch(/hypothes/i);
  });

  test('handles empty errors/console/network/failedChecks gracefully', () => {
    const empty = evidence({ errors: [], failedChecks: [], console: [], network: [] });
    const { userText } = buildAnalysisPrompt(empty);

    expect(userText).toContain('(none)');
  });
});
