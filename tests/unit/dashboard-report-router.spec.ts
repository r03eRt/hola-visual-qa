import { test, expect } from '@playwright/test';
import { handleReportRequest, type ReportRouterDeps } from '../../src/dashboard/report-router.js';
import type { RunManifest, RunSummary, ScenarioResult } from '../../src/domain/index.js';

/**
 * Pure unit tests for the report-viewer dispatcher (#32 /
 * docs/features/local-dashboard-report-viewer/SPEC.md). The dispatcher is
 * pure/async and delegates to `../report-reader.js`'s `listRuns`/`readRun`,
 * so tests inject a fake `ReportReaderDeps` (in-memory readdir/readFile) —
 * no real fs is ever touched here.
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

/** Builds fake reader deps backed by an in-memory map of absolute-path -> value. */
function buildDeps(files: Record<string, unknown>, dirNames: string[]): ReportRouterDeps {
  const serialized = new Map<string, string>();
  for (const [path, value] of Object.entries(files)) {
    serialized.set(path, JSON.stringify(value));
  }

  return {
    reader: {
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
      }
    }
  };
}

test.describe('handleReportRequest', () => {
  test('returns undefined for unrelated paths, falling back to the static router', async () => {
    const deps = buildDeps({}, []);
    expect(await handleReportRequest('GET', '/', deps)).toBeUndefined();
    expect(await handleReportRequest('GET', '/healthz', deps)).toBeUndefined();
    expect(await handleReportRequest('GET', '/api/runs', deps)).toBeUndefined();
  });

  test('GET /runs renders the run list', async () => {
    const runId = '20260101T000000Z-aaaa';
    const deps = buildDeps({ [`${OUTPUT_DIR}/${runId}/summary.json`]: summary({ runId }) }, [runId]);

    const response = await handleReportRequest('GET', '/runs', deps);
    expect(response?.status).toBe(200);
    expect(response?.contentType).toBe('text/html; charset=utf-8');
    expect(response?.body).toContain(runId);
    expect(response?.body).toContain(`href="/runs/${runId}"`);
  });

  test('GET /runs with no runs renders the empty state', async () => {
    const deps = buildDeps({}, []);
    const response = await handleReportRequest('GET', '/runs', deps);
    expect(response?.status).toBe(200);
    expect(response?.body).toContain('No runs found');
  });

  test('non-GET on /runs returns 405', async () => {
    const deps = buildDeps({}, []);
    const response = await handleReportRequest('POST', '/runs', deps);
    expect(response?.status).toBe(405);
  });

  test('GET /runs/:id renders the run report for a known run', async () => {
    const runId = '20260101T000000Z-aaaa';
    const deps = buildDeps(
      {
        [`${OUTPUT_DIR}/${runId}/manifest.json`]: manifest(),
        [`${OUTPUT_DIR}/${runId}/summary.json`]: summary({ runId }),
        [`${OUTPUT_DIR}/${runId}/scenarios/scenario-a/result.json`]: scenarioResult()
      },
      [runId]
    );

    const response = await handleReportRequest('GET', `/runs/${runId}`, deps);
    expect(response?.status).toBe(200);
    expect(response?.contentType).toBe('text/html; charset=utf-8');
    expect(response?.body).toContain(runId);
    expect(response?.body).toContain('scenario-a');
  });

  test('GET /runs/:id with an unknown id returns a 404 html page', async () => {
    const deps = buildDeps({}, []);
    const response = await handleReportRequest('GET', '/runs/does-not-exist', deps);
    expect(response?.status).toBe(404);
    expect(response?.contentType).toBe('text/html; charset=utf-8');
    expect(response?.body).toContain('not found');
  });

  test('non-GET on /runs/:id returns 405', async () => {
    const deps = buildDeps({}, []);
    const response = await handleReportRequest('DELETE', '/runs/20260101T000000Z-aaaa', deps);
    expect(response?.status).toBe(405);
  });
});
