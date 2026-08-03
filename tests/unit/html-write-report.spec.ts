import { test, expect } from '@playwright/test';
import type { ScenarioResult, RunManifest, Scenario, RunResult } from '../../src/domain/index.js';
import { buildRunResult, type BuildRunResultInput } from '../../src/reporting/aggregate.js';
import { buildReportModel } from '../../src/reporting/html/report-model.js';
import { writeHtmlReport } from '../../src/reporting/html/write-report.js';

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

test.describe('writeHtmlReport', () => {
  test('renders via the injected writeFile and writes the rendered HTML at outPath', async () => {
    const run = runFrom([scenarioResult({ status: 'passed' })]);
    const model = buildReportModel(run);

    const calls: Array<{ path: string; data: string }> = [];
    const fakeWriteFile = async (path: string, data: string): Promise<void> => {
      calls.push({ path, data });
    };

    await writeHtmlReport(model, 'reports/run/index.html', { writeFile: fakeWriteFile });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('reports/run/index.html');
    expect(calls[0]!.data.startsWith('<!doctype html')).toBe(true);
  });

  test('never touches the real filesystem when a fake writeFile is injected', async () => {
    const run = runFrom([scenarioResult({ status: 'failed' })]);
    const model = buildReportModel(run);

    let called = false;
    const fakeWriteFile = async (): Promise<void> => {
      called = true;
    };

    await writeHtmlReport(model, 'unused/path.html', { writeFile: fakeWriteFile });

    expect(called).toBe(true);
  });
});
