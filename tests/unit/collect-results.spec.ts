import { test, expect } from '@playwright/test';
import { parseScenarioResult, type Scenario } from '../../src/domain/index.js';
import { collectScenarioResults } from '../../src/orchestrator/collect-results.js';
import type { RawScenarioOutcome } from '../../src/orchestrator/raw-outcome.js';

/**
 * Hermetic: pure join logic, no fs/spawn. See
 * docs/features/execution-run-contract/SPEC.md.
 */

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'home-desktop-accepted-ES-ads',
    page: { path: '/' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true,
    ...overrides
  };
}

function outcome(overrides: Partial<RawScenarioOutcome> = {}): RawScenarioOutcome {
  return {
    scenarioId: 'home-desktop-accepted-ES-ads',
    status: 'passed',
    startedAt: '2026-01-01T10:00:00.000Z',
    finishedAt: '2026-01-01T10:00:01.000Z',
    durationMs: 1000,
    errorMessages: [],
    ...overrides
  };
}

const FALLBACK_TIMESTAMP = '2026-01-01T09:00:00.000Z';

test.describe('collectScenarioResults', () => {
  test('joins by id, preserving planned order (not outcome order)', () => {
    const scenarios = [scenario({ id: 'a' }), scenario({ id: 'b' }), scenario({ id: 'c' })];
    const outcomes = [outcome({ scenarioId: 'c' }), outcome({ scenarioId: 'a' })];

    const results = collectScenarioResults(outcomes, scenarios, FALLBACK_TIMESTAMP);

    expect(results.map((r) => r.scenario.id)).toEqual(['a', 'b', 'c']);
  });

  test('an unmatched planned scenario becomes skipped with no errors and the fallback timestamp', () => {
    const scenarios = [scenario({ id: 'never-ran' })];
    const results = collectScenarioResults([], scenarios, FALLBACK_TIMESTAMP);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: 'skipped',
      errors: [],
      startedAt: FALLBACK_TIMESTAMP,
      finishedAt: FALLBACK_TIMESTAMP,
      durationMs: 0
    });
  });

  test('raw error messages are normalized to report-safe NormalizedErrors', () => {
    const scenarios = [scenario({ id: 'home' })];
    const outcomes = [
      outcome({
        scenarioId: 'home',
        status: 'failed',
        errorMessages: ['Screenshot comparison failed', 'Authorization: Bearer sk-should-be-redacted-1234567890']
      })
    ];

    const [result] = collectScenarioResults(outcomes, scenarios, FALLBACK_TIMESTAMP);

    expect(result!.errors).toHaveLength(2);
    for (const error of result!.errors) {
      expect(error.category).toBe('visual_regression');
      expect(error.phase).toBe('assertion');
      expect(error.severity).toBe('error');
      expect(error.scenarioId).toBe('home');
    }
    // Secret-shaped text must never survive normalization.
    const serialized = JSON.stringify(result!.errors).toLowerCase();
    expect(serialized).not.toContain('sk-should-be-redacted');
    expect(serialized).not.toContain('bearer');
  });

  test('every output result is parseScenarioResult-clean', () => {
    const scenarios = [scenario({ id: 'passing' }), scenario({ id: 'failing' }), scenario({ id: 'missing' })];
    const outcomes = [
      outcome({ scenarioId: 'passing', status: 'passed' }),
      outcome({ scenarioId: 'failing', status: 'failed', errorMessages: ['boom'] })
    ];

    const results = collectScenarioResults(outcomes, scenarios, FALLBACK_TIMESTAMP);

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(() => parseScenarioResult(result)).not.toThrow();
    }
  });

  test('a passed outcome yields a passed ScenarioResult with no errors', () => {
    const scenarios = [scenario({ id: 'ok' })];
    const outcomes = [outcome({ scenarioId: 'ok', status: 'passed' })];

    const [result] = collectScenarioResults(outcomes, scenarios, FALLBACK_TIMESTAMP);

    expect(result?.status).toBe('passed');
    expect(result?.errors).toEqual([]);
  });

  test('never invents artifacts: no artifacts key when the outcome has none', () => {
    const scenarios = [scenario({ id: 'ok' })];
    const outcomes = [outcome({ scenarioId: 'ok' })];

    const [result] = collectScenarioResults(outcomes, scenarios, FALLBACK_TIMESTAMP);

    expect(result?.artifacts).toBeUndefined();
  });
});
