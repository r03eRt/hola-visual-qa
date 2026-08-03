import { test, expect } from '@playwright/test';
import { listRuns, readRun, type ReportReaderDeps } from '../../src/dashboard/report-reader.js';
import type { RunManifest, RunSummary, ScenarioResult } from '../../src/domain/index.js';

/**
 * Hermetic unit tests for the report reader (#32 /
 * docs/features/local-dashboard-report-viewer/SPEC.md). All disk access is
 * injected via fake ports — no real fs. Paths are still built through the
 * real `../artifacts/paths.js` builders inside the reader, so unsafe
 * run-ids/scenario-ids are exercised exactly as they would be in production.
 */

const OUTPUT_DIR = '/fake/reports';

function manifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    toolVersion: '0.0.0',
    os: 'darwin arm64',
    browser: { name: 'chromium', version: '120.0' },
    configHash: 'a'.repeat(8),
    scenarioIds: ['scenario-a'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: '20260101T000000Z-aaaa',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
    deterministicFailure: false,
    ...overrides
  };
}

function scenarioResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenario: {
      id: 'scenario-a',
      page: { path: '/' },
      device: 'desktop',
      consent: 'accepted',
      country: 'ES',
      adsEnabled: true
    },
    status: 'passed',
    errors: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    ...overrides
  };
}

/** Builds fake ports backed by an in-memory map of absolute-path -> JSON string. */
function buildDeps(files: Record<string, unknown>, dirNames: string[] = []): ReportReaderDeps {
  const serialized = new Map<string, string>();
  for (const [path, value] of Object.entries(files)) {
    serialized.set(path, JSON.stringify(value));
  }

  return {
    outputDir: OUTPUT_DIR,
    readdir: async (dir: string) => {
      if (dir !== OUTPUT_DIR) {
        throw new Error('ENOENT');
      }
      return dirNames;
    },
    readFile: async (path: string) => {
      const content = serialized.get(path);
      if (content === undefined) {
        throw new Error('ENOENT');
      }
      return content;
    },
    statIsDir: async () => true
  };
}

test.describe('listRuns', () => {
  test('returns summaries sorted by runId descending', async () => {
    const deps = buildDeps(
      {
        [`${OUTPUT_DIR}/20260101T000000Z-aaaa/summary.json`]: summary({ runId: '20260101T000000Z-aaaa' }),
        [`${OUTPUT_DIR}/20260201T000000Z-bbbb/summary.json`]: summary({ runId: '20260201T000000Z-bbbb' })
      },
      ['20260101T000000Z-aaaa', '20260201T000000Z-bbbb']
    );

    const runs = await listRuns(deps);
    expect(runs.map((r) => r.runId)).toEqual(['20260201T000000Z-bbbb', '20260101T000000Z-aaaa']);
  });

  test('skips entries with a missing or invalid summary.json', async () => {
    const deps = buildDeps(
      {
        [`${OUTPUT_DIR}/20260101T000000Z-aaaa/summary.json`]: summary({ runId: '20260101T000000Z-aaaa' }),
        [`${OUTPUT_DIR}/20260201T000000Z-bbbb/summary.json`]: { not: 'a valid summary' }
      },
      ['20260101T000000Z-aaaa', '20260201T000000Z-bbbb', '20260301T000000Z-cccc']
    );

    const runs = await listRuns(deps);
    expect(runs.map((r) => r.runId)).toEqual(['20260101T000000Z-aaaa']);
  });

  test('skips entries whose name is an unsafe segment', async () => {
    const deps = buildDeps(
      { [`${OUTPUT_DIR}/20260101T000000Z-aaaa/summary.json`]: summary() },
      ['20260101T000000Z-aaaa', '../escape', 'nested/dir']
    );

    const runs = await listRuns(deps);
    expect(runs.map((r) => r.runId)).toEqual(['20260101T000000Z-aaaa']);
  });

  test('returns an empty list when the output directory cannot be read', async () => {
    const deps: ReportReaderDeps = {
      outputDir: OUTPUT_DIR,
      readdir: async () => {
        throw new Error('ENOENT');
      }
    };

    expect(await listRuns(deps)).toEqual([]);
  });
});

test.describe('readRun', () => {
  test('reconstructs a valid RunResult from manifest + summary + scenario results', async () => {
    const runId = '20260101T000000Z-aaaa';
    const deps = buildDeps({
      [`${OUTPUT_DIR}/${runId}/manifest.json`]: manifest(),
      [`${OUTPUT_DIR}/${runId}/summary.json`]: summary({ runId }),
      [`${OUTPUT_DIR}/${runId}/scenarios/scenario-a/result.json`]: scenarioResult()
    });

    const run = await readRun(runId, deps);
    expect(run).toBeDefined();
    expect(run?.runId).toBe(runId);
    expect(run?.results).toHaveLength(1);
    expect(run?.results[0]?.scenario.id).toBe('scenario-a');
    expect(run?.counts).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 });
  });

  test('an unsafe run-id returns undefined', async () => {
    const deps = buildDeps({});
    expect(await readRun('../escape', deps)).toBeUndefined();
    expect(await readRun('nested/dir', deps)).toBeUndefined();
  });

  test('a missing manifest returns undefined', async () => {
    const runId = '20260101T000000Z-aaaa';
    const deps = buildDeps({
      [`${OUTPUT_DIR}/${runId}/summary.json`]: summary({ runId })
    });

    expect(await readRun(runId, deps)).toBeUndefined();
  });

  test('a missing result.json for a listed scenario returns undefined', async () => {
    const runId = '20260101T000000Z-aaaa';
    const deps = buildDeps({
      [`${OUTPUT_DIR}/${runId}/manifest.json`]: manifest(),
      [`${OUTPUT_DIR}/${runId}/summary.json`]: summary({ runId })
      // scenario-a/result.json intentionally missing
    });

    expect(await readRun(runId, deps)).toBeUndefined();
  });

  test('an absent run directory returns undefined, never throws', async () => {
    const deps = buildDeps({});
    await expect(readRun('20260101T000000Z-missing', deps)).resolves.toBeUndefined();
  });
});
