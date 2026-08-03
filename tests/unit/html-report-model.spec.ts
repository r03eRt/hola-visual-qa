import { test, expect } from '@playwright/test';
import { normalizeError, type ScenarioResult, type RunManifest, type Scenario, type RunResult } from '../../src/domain/index.js';
import { buildRunResult, type BuildRunResultInput } from '../../src/reporting/aggregate.js';
import { buildReportModel } from '../../src/reporting/html/report-model.js';
import type { AiAnalysis } from '../../src/ai/analysis.js';
import type { RedactionNotes } from '../../src/evidence/contract.js';

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

function runFrom(results: ScenarioResult[], input: Partial<BuildRunResultInput> = {}): RunResult {
  return buildRunResult({
    runId: '20260731T100000Z-abc123',
    startedAt: '2026-07-31T10:00:00.000Z',
    finishedAt: '2026-07-31T10:05:00.000Z',
    manifest: manifest(),
    results,
    ...input
  });
}

test.describe('buildReportModel', () => {
  test('a passing run has no groups but has rows', () => {
    const run = runFrom([scenarioResult({ status: 'passed' })]);

    const model = buildReportModel(run);

    expect(model.groups).toEqual([]);
    expect(model.rows).toHaveLength(1);
    expect(model.deterministicFailure).toBe(false);
    expect(model.counts).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 });
    expect(model.tool).toEqual({ version: '0.0.0', os: 'darwin arm64', browser: 'chromium 120.0' });
  });

  test('a failing run produces groups and rows with derived category/message', () => {
    const hardError = normalizeError(new Error('Visual diff exceeded threshold'), {
      category: 'visual_regression',
      phase: 'assertion'
    });
    const run = runFrom([scenarioResult({ status: 'failed', errors: [hardError] })]);

    const model = buildReportModel(run);

    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]!.page).toBe('/');
    expect(model.groups[0]!.failures).toHaveLength(1);

    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]!.category).toBe('visual_regression');
    expect(model.rows[0]!.message).toBe('Visual diff exceeded threshold');
    expect(model.rows[0]!.status).toBe('failed');
  });

  test('picks the first non-warning error over a leading warning', () => {
    const warning = normalizeError(new Error('AI provider unavailable'), {
      category: 'ai_provider_error',
      phase: 'ai_analysis'
    });
    const hardError = normalizeError(new Error('Console error observed'), {
      category: 'console_error',
      phase: 'diagnostics'
    });
    const run = runFrom([scenarioResult({ status: 'failed', errors: [warning, hardError] })]);

    const model = buildReportModel(run);

    expect(model.rows[0]!.category).toBe('console_error');
    expect(model.rows[0]!.message).toBe('Console error observed');
  });

  test('attaches AI analysis only when the analyses map has the scenario id', () => {
    const results = [
      scenarioResult({ scenario: scenario({ id: 'a' }), status: 'passed' }),
      scenarioResult({ scenario: scenario({ id: 'b' }), status: 'passed' })
    ];
    const run = runFrom(results);
    const analyses = new Map([['a', analysis()]]);

    const model = buildReportModel(run, { analyses });

    const rowA = model.rows.find((r) => r.scenarioId === 'a');
    const rowB = model.rows.find((r) => r.scenarioId === 'b');

    expect(rowA?.analysis).toEqual(analysis());
    expect(rowB?.analysis).toBeUndefined();
  });

  test('preserves deterministic row order equal to input order', () => {
    const results = [
      scenarioResult({ scenario: scenario({ id: 'c' }), status: 'passed' }),
      scenarioResult({ scenario: scenario({ id: 'a' }), status: 'failed' }),
      scenarioResult({ scenario: scenario({ id: 'b' }), status: 'skipped' })
    ];
    const run = runFrom(results);

    const model = buildReportModel(run);

    expect(model.rows.map((r) => r.scenarioId)).toEqual(['c', 'a', 'b']);
  });

  test('does not mutate the input RunResult', () => {
    const run = runFrom([scenarioResult({ status: 'passed' })]);
    const runCopy = JSON.parse(JSON.stringify(run)) as RunResult;

    buildReportModel(run);

    expect(run).toEqual(runCopy);
  });
});
