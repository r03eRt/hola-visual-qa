import { test, expect } from '@playwright/test';
import { normalizeError, type ScenarioResult, type RunManifest, type Scenario } from '../../src/domain/index.js';
import {
  computeCounts,
  buildRunResult,
  groupFailuresByPage,
  formatCliSummary,
  exitCodeForRun,
  type BuildRunResultInput
} from '../../src/reporting/index.js';
import { computeDeterministicFailure } from '../../src/domain/index.js';

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'home-desktop-accepted-es',
    page: { path: '/' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true,
    ...overrides
  };
}

function scenarioResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenario: scenario(),
    status: 'passed',
    errors: [],
    startedAt: '2026-07-31T10:00:00.000Z',
    finishedAt: '2026-07-31T10:00:01.000Z',
    durationMs: 1000,
    ...overrides
  };
}

function manifest(): RunManifest {
  return {
    toolVersion: '0.0.0',
    os: 'darwin arm64',
    browser: { name: 'chromium', version: '120.0' },
    configHash: 'a'.repeat(64),
    scenarioIds: ['home-desktop-accepted-es'],
    createdAt: '2026-07-31T09:59:00.000Z'
  };
}

test.describe('computeCounts', () => {
  test('tallies passed/failed/skipped and total equals sum and input length', () => {
    const results = [
      scenarioResult({ status: 'passed' }),
      scenarioResult({ status: 'failed' }),
      scenarioResult({ status: 'skipped' }),
      scenarioResult({ status: 'passed' })
    ];

    const counts = computeCounts(results);

    expect(counts).toEqual({ passed: 2, failed: 1, skipped: 1, total: 4 });
    expect(counts.total).toBe(counts.passed + counts.failed + counts.skipped);
    expect(counts.total).toBe(results.length);
  });

  test('handles an empty result set', () => {
    expect(computeCounts([])).toEqual({ passed: 0, failed: 0, skipped: 0, total: 0 });
  });
});

test.describe('buildRunResult', () => {
  test('an all-warning passed set stays PASS and matches computeDeterministicFailure', () => {
    const warningError = normalizeError(new Error('AI provider unavailable'), {
      category: 'ai_provider_error',
      phase: 'ai_analysis'
    });
    const results = [scenarioResult({ status: 'passed', errors: [warningError] })];

    const input: BuildRunResultInput = {
      runId: '20260731T100000Z-abc123',
      startedAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:05:00.000Z',
      manifest: manifest(),
      results
    };

    const run = buildRunResult(input);

    expect(run.deterministicFailure).toBe(false);
    expect(run.deterministicFailure).toBe(computeDeterministicFailure(results));
    expect(run.counts).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 });
    expect(run.results).toEqual(results);
  });

  test('a hard failure flips deterministicFailure to true', () => {
    const hardError = normalizeError(new Error('Visual diff exceeded threshold'), {
      category: 'visual_regression',
      phase: 'assertion'
    });
    const results = [scenarioResult({ status: 'failed', errors: [hardError] })];

    const run = buildRunResult({
      runId: '20260731T100000Z-abc123',
      startedAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:05:00.000Z',
      manifest: manifest(),
      results
    });

    expect(run.deterministicFailure).toBe(true);
    expect(run.deterministicFailure).toBe(computeDeterministicFailure(results));
  });

  test('preserves input result order and does not mutate the input array', () => {
    const results = [
      scenarioResult({ scenario: scenario({ id: 'a' }), status: 'passed' }),
      scenarioResult({ scenario: scenario({ id: 'b' }), status: 'failed' })
    ];
    const originalResultsCopy = [...results];

    const run = buildRunResult({
      runId: '20260731T100000Z-abc123',
      startedAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:05:00.000Z',
      manifest: manifest(),
      results
    });

    expect(run.results.map((r) => r.scenario.id)).toEqual(['a', 'b']);
    expect(results).toEqual(originalResultsCopy);
  });

  test('returns a schema-valid RunResult (parseable without throwing)', () => {
    const run = buildRunResult({
      runId: '20260731T100000Z-abc123',
      startedAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:05:00.000Z',
      manifest: manifest(),
      results: [scenarioResult()]
    });

    expect(run.runId).toBe('20260731T100000Z-abc123');
    expect(run.manifest).toEqual(manifest());
  });
});

test.describe('groupFailuresByPage', () => {
  test('buckets failures by page in first-seen order, keeping per-page input order', () => {
    const error1 = normalizeError(new Error('Nav failed'), { category: 'navigation_error', phase: 'navigation' });
    const error2 = normalizeError(new Error('Console error'), { category: 'console_error', phase: 'diagnostics' });

    const results = [
      scenarioResult({
        scenario: scenario({ id: 'contact-1', page: { path: '/contact' } }),
        status: 'failed',
        errors: [error1]
      }),
      scenarioResult({
        scenario: scenario({ id: 'home-1', page: { path: '/' } }),
        status: 'failed',
        errors: [error2]
      }),
      scenarioResult({
        scenario: scenario({ id: 'contact-2', page: { path: '/contact' } }),
        status: 'failed',
        errors: [error1]
      })
    ];

    const groups = groupFailuresByPage(results);

    expect(groups.map((g) => g.page)).toEqual(['/contact', '/']);
    expect(groups[0]!.failures.map((f) => f.scenarioId)).toEqual(['contact-1', 'contact-2']);
    expect(groups[1]!.failures.map((f) => f.scenarioId)).toEqual(['home-1']);
  });

  test('probable category is the first non-warning error else the first error else unknown_error', () => {
    const warning = normalizeError(new Error('AI note'), {
      category: 'ai_provider_error',
      phase: 'ai_analysis'
    });
    const hard = normalizeError(new Error('Regression detected'), {
      category: 'visual_regression',
      phase: 'assertion'
    });

    const withWarningThenHard = scenarioResult({
      scenario: scenario({ id: 'a', page: { path: '/a' } }),
      status: 'failed',
      errors: [warning, hard]
    });
    const withOnlyWarningButFailedStatus = scenarioResult({
      scenario: scenario({ id: 'b', page: { path: '/b' } }),
      status: 'failed',
      errors: [warning]
    });

    const groups = groupFailuresByPage([withWarningThenHard, withOnlyWarningButFailedStatus]);

    expect(groups[0]!.failures[0]!.category).toBe('visual_regression');
    expect(groups[0]!.failures[0]!.message).toBe('Regression detected');
    expect(groups[1]!.failures[0]!.category).toBe('ai_provider_error');
  });

  test('excludes skipped and clean passed results', () => {
    const warning = normalizeError(new Error('AI note'), {
      category: 'ai_provider_error',
      phase: 'ai_analysis'
    });

    const results = [
      scenarioResult({ status: 'skipped' }),
      scenarioResult({ status: 'passed' }),
      scenarioResult({ status: 'passed', errors: [warning] }),
      scenarioResult({ status: 'failed' })
    ];

    const groups = groupFailuresByPage(results);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.failures).toHaveLength(1);
  });

  test('a passed result with a non-warning error counts as a failure', () => {
    const hard = normalizeError(new Error('Console error observed'), {
      category: 'console_error',
      phase: 'diagnostics'
    });
    const results = [scenarioResult({ status: 'passed', errors: [hard] })];

    const groups = groupFailuresByPage(results);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.failures[0]!.category).toBe('console_error');
  });

  test('a failed result with no errors falls back to unknown_error and the fixed message', () => {
    const results = [scenarioResult({ status: 'failed', errors: [] })];

    const groups = groupFailuresByPage(results);

    expect(groups[0]!.failures[0]!.category).toBe('unknown_error');
    expect(groups[0]!.failures[0]!.message).toBe('Scenario failed without a normalized error');
  });

  test('includes pageName when present on the scenario page', () => {
    const results = [
      scenarioResult({
        scenario: scenario({ page: { path: '/contact', name: 'Contact Us' } }),
        status: 'failed',
        errors: []
      })
    ];

    const groups = groupFailuresByPage(results);

    expect(groups[0]!.pageName).toBe('Contact Us');
  });

  test('returns an empty array for a clean run', () => {
    expect(groupFailuresByPage([scenarioResult({ status: 'passed' })])).toEqual([]);
  });
});

test.describe('exitCodeForRun', () => {
  test('is 0 on a clean run', () => {
    const run = buildRunResult({
      runId: '20260731T100000Z-abc123',
      startedAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:05:00.000Z',
      manifest: manifest(),
      results: [scenarioResult({ status: 'passed' })]
    });

    expect(exitCodeForRun(run)).toBe(0);
  });

  test('is 1 when there is a deterministic failure', () => {
    const run = buildRunResult({
      runId: '20260731T100000Z-abc123',
      startedAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:05:00.000Z',
      manifest: manifest(),
      results: [scenarioResult({ status: 'failed' })]
    });

    expect(exitCodeForRun(run)).toBe(1);
  });

  test('AI-only warnings do not produce a nonzero exit', () => {
    const warning = normalizeError(new Error('AI note'), {
      category: 'ai_provider_error',
      phase: 'ai_analysis'
    });
    const run = buildRunResult({
      runId: '20260731T100000Z-abc123',
      startedAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:05:00.000Z',
      manifest: manifest(),
      results: [scenarioResult({ status: 'passed', errors: [warning] })]
    });

    expect(exitCodeForRun(run)).toBe(0);
  });
});

test.describe('formatCliSummary', () => {
  test('is deterministic and contains counts, result and no failures block on a clean run', () => {
    const run = buildRunResult({
      runId: '20260731T100000Z-abc123',
      startedAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:05:00.000Z',
      manifest: manifest(),
      results: [scenarioResult({ status: 'passed' }), scenarioResult({ status: 'skipped' })]
    });

    const summary1 = formatCliSummary(run);
    const summary2 = formatCliSummary(run);

    expect(summary1).toBe(summary2);
    expect(summary1).toContain('20260731T100000Z-abc123');
    expect(summary1).toContain('1 passed, 0 failed, 1 skipped (2 total)');
    expect(summary1).toContain('Result: PASS');
    expect(summary1).not.toContain('Failures by page');
  });

  test('includes a failures-by-page block with categories (not raw messages) when there are failures', () => {
    const hard = normalizeError(new Error('Authorization: Bearer sk-topsecret123456 leaked in response'), {
      category: 'network_failure',
      phase: 'navigation'
    });
    const run = buildRunResult({
      runId: '20260731T100000Z-abc123',
      startedAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:05:00.000Z',
      manifest: manifest(),
      results: [
        scenarioResult({ scenario: scenario({ page: { path: '/checkout' } }), status: 'failed', errors: [hard] })
      ]
    });

    const summary = formatCliSummary(run);

    expect(summary).toContain('Result: FAIL (deterministic)');
    expect(summary).toContain('Failures by page:');
    expect(summary).toContain('/checkout: 1 (network_failure)');
    expect(summary).not.toContain('?');
    expect(summary).not.toContain('sk-topsecret123456');
    expect(summary).not.toContain('Authorization');
    expect(summary).not.toContain('cookie');
  });
});
