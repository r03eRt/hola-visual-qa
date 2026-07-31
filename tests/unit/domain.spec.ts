import { test, expect } from '@playwright/test';
import {
  ErrorCategory,
  normalizeError,
  NormalizedErrorSchema,
  type NormalizedError
} from '../../src/domain/error.js';
import {
  ScenarioSchema,
  ScenarioResultSchema,
  RunManifestSchema,
  RunResultSchema,
  RunSummarySchema,
  computeDeterministicFailure,
  type Scenario,
  type ScenarioResult
} from '../../src/domain/result.js';

const ERROR_CATEGORIES = [
  'configuration_error',
  'environment_setup_error',
  'navigation_error',
  'state_verification_error',
  'readiness_timeout',
  'visual_regression',
  'placement_failure',
  'console_error',
  'network_failure',
  'artifact_error',
  'ai_provider_error',
  'internal_error'
];

function validScenario(): Scenario {
  return {
    id: 'home-desktop-accepted-ES-ads',
    page: { path: '/' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true
  };
}

function validScenarioResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenario: validScenario(),
    status: 'passed',
    errors: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    ...overrides
  };
}

function validManifest() {
  return {
    toolVersion: '1.0.0',
    os: 'darwin',
    browser: { name: 'chromium', version: '120.0' },
    configHash: 'abc123',
    scenarioIds: ['home-desktop-accepted-ES-ads'],
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

test.describe('ErrorCategory', () => {
  test('contains exactly the 12 ERROR_MODEL categories', () => {
    expect(ErrorCategory).toHaveLength(12);
    expect([...ErrorCategory].sort()).toEqual([...ERROR_CATEGORIES].sort());
  });
});

test.describe('normalizeError', () => {
  test('sets a stable code, ISO timestamp and default severity', () => {
    const err = normalizeError(new Error('navigation timed out'), {
      category: 'navigation_error',
      phase: 'navigation',
      scenarioId: 'home-desktop-accepted-ES-ads'
    });
    expect(err.category).toBe('navigation_error');
    expect(err.phase).toBe('navigation');
    expect(err.scenarioId).toBe('home-desktop-accepted-ES-ads');
    expect(err.severity).toBe('error');
    expect(typeof err.code).toBe('string');
    expect(err.code.length).toBeGreaterThan(0);
    expect(() => new Date(err.timestamp).toISOString()).not.toThrow();
    expect(new Date(err.timestamp).toISOString()).toBe(err.timestamp);
  });

  test('redacts authorization headers, cookie values and api-key-like tokens from the message', () => {
    const secretMessage =
      'Request failed: Authorization: Bearer sk-abcdef1234567890, Cookie: session=deadbeef123456; other=1, apiKey=sk-live-987654321';
    const err = normalizeError(new Error(secretMessage), {
      category: 'network_failure',
      phase: 'navigation'
    });
    expect(err.message).not.toContain('sk-abcdef1234567890');
    expect(err.message).not.toContain('sk-live-987654321');
    expect(err.message).not.toContain('deadbeef123456');
    expect(err.message.toLowerCase()).not.toContain('bearer sk-');
  });

  test('never leaks a raw stack trace into the message', () => {
    const error = new Error('boom');
    error.stack = `Error: boom\n    at Object.<anonymous> (/secret/path/file.js:1:1)`;
    const err = normalizeError(error, { category: 'internal_error', phase: 'assertion' });
    expect(err.message).not.toContain('/secret/path/file.js');
    expect(err.message).not.toContain('at Object.<anonymous>');
  });

  test('defaults AI-provider errors to severity warning', () => {
    const err = normalizeError(new Error('AI provider request failed'), {
      category: 'ai_provider_error',
      phase: 'ai_analysis'
    });
    expect(err.severity).toBe('warning');
  });

  test('allows an explicit severity override', () => {
    const err = normalizeError(new Error('boom'), {
      category: 'internal_error',
      phase: 'assertion',
      severity: 'warning'
    });
    expect(err.severity).toBe('warning');
  });

  test('produces output that validates against NormalizedErrorSchema', () => {
    const err = normalizeError(new Error('boom'), { category: 'internal_error', phase: 'assertion' });
    const result = NormalizedErrorSchema.safeParse(err);
    expect(result.success).toBe(true);
  });
});

test.describe('Scenario / ScenarioResult schema round-trip', () => {
  test('serializes and re-parses a valid scenario result', () => {
    const scenarioResult = validScenarioResult();
    const serialized = JSON.parse(JSON.stringify(scenarioResult));
    const result = ScenarioResultSchema.safeParse(serialized);
    expect(result.success).toBe(true);
  });

  test('ScenarioSchema round-trips a valid scenario', () => {
    const scenario = validScenario();
    const serialized = JSON.parse(JSON.stringify(scenario));
    const result = ScenarioSchema.safeParse(serialized);
    expect(result.success).toBe(true);
  });

  test('RunManifestSchema round-trips a valid manifest', () => {
    const manifest = validManifest();
    const serialized = JSON.parse(JSON.stringify(manifest));
    const result = RunManifestSchema.safeParse(serialized);
    expect(result.success).toBe(true);
  });

  test('RunResultSchema and RunSummarySchema round-trip a valid run', () => {
    const scenarioResult = validScenarioResult();
    const runResult = {
      runId: 'run-2026-01-01T00-00-00',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:02.000Z',
      manifest: validManifest(),
      results: [scenarioResult],
      counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
      deterministicFailure: false
    };
    const serializedRun = JSON.parse(JSON.stringify(runResult));
    expect(RunResultSchema.safeParse(serializedRun).success).toBe(true);

    const summary = {
      runId: runResult.runId,
      startedAt: runResult.startedAt,
      finishedAt: runResult.finishedAt,
      counts: runResult.counts,
      deterministicFailure: runResult.deterministicFailure
    };
    expect(RunSummarySchema.safeParse(summary).success).toBe(true);
  });
});

test.describe('unknown-key rejection', () => {
  test('ScenarioSchema rejects unknown top-level keys', () => {
    const scenario = { ...validScenario(), bogus: true };
    expect(ScenarioSchema.safeParse(scenario).success).toBe(false);
  });

  test('ScenarioResultSchema rejects unknown top-level keys', () => {
    const scenarioResult = { ...validScenarioResult(), bogus: true };
    expect(ScenarioResultSchema.safeParse(scenarioResult).success).toBe(false);
  });

  test('RunManifestSchema rejects unknown top-level keys', () => {
    const manifest = { ...validManifest(), bogus: true };
    expect(RunManifestSchema.safeParse(manifest).success).toBe(false);
  });

  test('NormalizedErrorSchema rejects unknown top-level keys', () => {
    const err = {
      code: 'x',
      category: 'internal_error',
      message: 'm',
      phase: 'assertion',
      timestamp: '2026-01-01T00:00:00.000Z',
      severity: 'error',
      bogus: true
    };
    expect(NormalizedErrorSchema.safeParse(err).success).toBe(false);
  });
});

test.describe('secret-field rejection', () => {
  const secretFieldCases = [
    { apiKey: 'sk-123' },
    { authorization: 'Bearer sk-123' },
    { cookie: 'session=abc' },
    { apiToken: 'abc' },
    { secret: 'abc' }
  ];

  for (const secretFields of secretFieldCases) {
    test(`RunManifestSchema rejects manifest carrying ${Object.keys(secretFields)[0]}`, () => {
      const manifest = { ...validManifest(), ...secretFields };
      expect(RunManifestSchema.safeParse(manifest).success).toBe(false);
    });

    test(`ScenarioResultSchema rejects result carrying ${Object.keys(secretFields)[0]}`, () => {
      const scenarioResult = { ...validScenarioResult(), ...secretFields };
      expect(ScenarioResultSchema.safeParse(scenarioResult).success).toBe(false);
    });

    test(`RunResultSchema rejects run carrying ${Object.keys(secretFields)[0]}`, () => {
      const runResult = {
        runId: 'run-1',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:02.000Z',
        manifest: validManifest(),
        results: [validScenarioResult()],
        counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
        deterministicFailure: false,
        ...secretFields
      };
      expect(RunResultSchema.safeParse(runResult).success).toBe(false);
    });
  }
});

test.describe('deterministicFailure computation', () => {
  test('is false when all results pass', () => {
    const results = [validScenarioResult({ status: 'passed' })];
    expect(computeDeterministicFailure(results)).toBe(false);
  });

  test('is false when only skipped results exist', () => {
    const results = [validScenarioResult({ status: 'skipped' })];
    expect(computeDeterministicFailure(results)).toBe(false);
  });

  test('is true when a non-skipped result has status failed', () => {
    const results = [validScenarioResult({ status: 'failed' })];
    expect(computeDeterministicFailure(results)).toBe(true);
  });

  test('is true when a passed-status result carries a non-warning error', () => {
    const err: NormalizedError = normalizeError(new Error('boom'), {
      category: 'visual_regression',
      phase: 'assertion'
    });
    const results = [validScenarioResult({ status: 'failed', errors: [err] })];
    expect(computeDeterministicFailure(results)).toBe(true);
  });

  test('AI provider warnings alone never trigger deterministic failure', () => {
    const aiWarning = normalizeError(new Error('AI provider request failed'), {
      category: 'ai_provider_error',
      phase: 'ai_analysis'
    });
    expect(aiWarning.severity).toBe('warning');
    const results = [validScenarioResult({ status: 'passed', errors: [aiWarning] })];
    expect(computeDeterministicFailure(results)).toBe(false);
  });
});
