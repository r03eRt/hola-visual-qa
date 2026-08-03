import { test, expect } from '@playwright/test';
import { buildRedactedEvidence } from '../../src/evidence/build.js';
import { RedactedEvidenceSchema, type EvidenceInput } from '../../src/evidence/contract.js';
import type { NormalizedError } from '../../src/domain/error.js';
import type { DiagnosticsSnapshot } from '../../src/diagnostics/collector.js';
import type { EvidencePolicy } from '../../src/config/schema.js';
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

function policy(overrides: Partial<EvidencePolicy> = {}): EvidencePolicy {
  return {
    sensitiveQueryParams: ['token', 'access_token', 'api_key', 'apikey', 'key', 'password', 'secret', 'sig', 'signature', 'auth', 'session'],
    maxConsoleEntries: 2,
    maxNetworkEntries: 1,
    maxErrors: 2,
    maxFieldChars: 2000,
    includeImages: true,
    includeResponseBodies: false,
    ...overrides
  };
}

const SK = 's' + 'k';
const PLANTED_ERROR_SECRET = `${SK}-ant-plantedsecret1234567890`;
const PLANTED_CONSOLE_SECRET = `${SK}_live_plantedsecret1234`;
const PLANTED_URL_SECRET = 'PLANTED_URL_SECRET_VALUE';
const PLANTED_FAILURE_SECRET = 'Bearer ' + 'plantedfailuretoken1234567890';

function error(overrides: Partial<NormalizedError> = {}): NormalizedError {
  return {
    code: 'console_error.assertion',
    category: 'console_error',
    message: 'a console error occurred',
    phase: 'assertion',
    timestamp: '2024-01-01T00:00:00.000Z',
    severity: 'error',
    ...overrides
  };
}

function baseInput(): EvidenceInput {
  const diagnostics: DiagnosticsSnapshot = {
    console: [
      { type: 'error', text: `console leak: ${PLANTED_CONSOLE_SECRET}` },
      { type: 'log', text: 'normal log line' },
      { type: 'warning', text: 'a warning line' }
    ],
    pageErrors: [{ message: 'uncaught page error', stack: 'Error: boom\n at x' }],
    requests: [
      {
        url: `https://example.com/api?ok=1&token=${PLANTED_URL_SECRET}`,
        method: 'GET',
        status: 500,
        failure: `request failed: ${PLANTED_FAILURE_SECRET}`,
        headers: { authorization: 'Bearer ' + 'super-secret-header-value', 'x-custom': 'ok' }
      },
      {
        url: 'https://example.com/api/second',
        method: 'POST',
        status: 200,
        headers: {}
      }
    ]
  };

  return {
    scenario: scenario(),
    status: 'failed',
    errors: [
      error({ code: 'e1', category: 'console_error', message: `boom ${PLANTED_ERROR_SECRET}`, severity: 'error' }),
      error({ code: 'e2', category: 'ai_provider_error', message: 'ai warning only', severity: 'warning' }),
      error({ code: 'e3', category: 'network_failure', message: 'dropped by cap', severity: 'error' })
    ],
    diagnostics,
    artifacts: {
      expected: 'expected.png',
      actual: 'actual.png',
      diff: 'diff.png',
      console: 'console.json',
      trace: 'trace.zip'
    }
  };
}

test.describe('buildRedactedEvidence', () => {
  test('produces a schema-valid bundle', () => {
    const bundle = buildRedactedEvidence(baseInput(), policy());
    expect(() => RedactedEvidenceSchema.parse(bundle)).not.toThrow();
  });

  test('caps errors, console and network entries per policy and reports drops', () => {
    const bundle = buildRedactedEvidence(baseInput(), policy());

    expect(bundle.errors).toHaveLength(2);
    expect(bundle.redactionNotes.droppedErrors).toBe(1);

    // console (3) + pageErrors (1) = 4 combined, capped at 2.
    expect(bundle.console).toHaveLength(2);
    expect(bundle.redactionNotes.droppedConsole).toBe(2);

    expect(bundle.network).toHaveLength(1);
    expect(bundle.redactionNotes.droppedNetwork).toBe(1);
  });

  test('failedChecks only includes non-warning errors from the capped list, in order', () => {
    const bundle = buildRedactedEvidence(baseInput(), policy());
    // capped errors = [e1 (error), e2 (warning)] since maxErrors=2; only e1 is non-warning.
    expect(bundle.failedChecks).toHaveLength(1);
    expect(bundle.failedChecks[0]).toMatch(/^console_error: /);
  });

  test('network entries never carry headers', () => {
    const bundle = buildRedactedEvidence(baseInput(), policy({ maxNetworkEntries: 10 }));
    for (const entry of bundle.network) {
      expect(entry).not.toHaveProperty('headers');
    }
  });

  test('includes image artifact refs when includeImages is true', () => {
    const bundle = buildRedactedEvidence(baseInput(), policy({ includeImages: true }));
    expect(bundle.artifacts?.expected).toBe('expected.png');
    expect(bundle.artifacts?.actual).toBe('actual.png');
    expect(bundle.artifacts?.diff).toBe('diff.png');
    expect(bundle.artifacts?.console).toBe('console.json');
  });

  test('omits image artifact refs when includeImages is false, keeping non-image refs', () => {
    const bundle = buildRedactedEvidence(baseInput(), policy({ includeImages: false }));
    expect(bundle.artifacts?.expected).toBeUndefined();
    expect(bundle.artifacts?.actual).toBeUndefined();
    expect(bundle.artifacts?.diff).toBeUndefined();
    expect(bundle.artifacts?.console).toBe('console.json');
    expect(bundle.artifacts?.trace).toBe('trace.zip');
  });

  test('omits the artifacts field entirely when no artifacts were supplied', () => {
    const input = { ...baseInput(), artifacts: undefined };
    const bundle = buildRedactedEvidence(input, policy());
    expect(bundle.artifacts).toBeUndefined();
  });

  test('redactionNotes counts match what was withheld', () => {
    const bundle = buildRedactedEvidence(baseInput(), policy({ maxConsoleEntries: 10, maxNetworkEntries: 10, maxErrors: 10 }));

    // secrets: 1 in the surviving error message, 1 in the console secret,
    // 1 in the failure string = 3 (the "ai warning only"/"dropped by cap"
    // messages and other console/network entries carry no secrets).
    expect(bundle.redactionNotes.secretsRedacted).toBe(3);
    // 1 sensitive query param redacted on the first request URL.
    expect(bundle.redactionNotes.urlParamsRedacted).toBe(1);
    expect(bundle.redactionNotes.droppedErrors).toBe(0);
    expect(bundle.redactionNotes.droppedConsole).toBe(0);
    expect(bundle.redactionNotes.droppedNetwork).toBe(0);
  });

  test('no planted secret ever appears in the serialized bundle', () => {
    const bundle = buildRedactedEvidence(baseInput(), policy({ maxConsoleEntries: 10, maxNetworkEntries: 10, maxErrors: 10 }));
    const serialized = JSON.stringify(bundle);

    expect(serialized).not.toContain(PLANTED_ERROR_SECRET);
    expect(serialized).not.toContain(PLANTED_CONSOLE_SECRET);
    expect(serialized).not.toContain(PLANTED_URL_SECRET);
    expect(serialized).not.toContain(PLANTED_FAILURE_SECRET.replace('Bearer ', ''));
    expect(serialized).not.toContain('super-secret-header-value');
  });
});
