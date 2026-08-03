import { test, expect } from '@playwright/test';
import { handleWebApiRequest, type WebApiDeps } from '../../src/dashboard/web-api-router.js';
import type { ReportReaderDeps } from '../../src/dashboard/report-reader.js';
import type { Scenario } from '../../src/domain/index.js';
import type { RunResult, RunSummary } from '../../src/domain/index.js';

/**
 * Hermetic unit tests for the PURE `/api/scenarios`, `/api/reports` and
 * `/api/reports/:id` dispatcher (docs/features/dashboard-web-api/SPEC.md).
 * No real fs/net — `resolveScenarios` and the `ReportReaderDeps` (readdir/
 * readFile/statIsDir) are all injected fakes, driven purely in-memory.
 */

const FAKE_SCENARIOS: Scenario[] = [
  {
    id: 'scenario-a',
    page: { path: '/a', name: 'Page A' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true,
    // Extra fields not part of ScenarioSummary — must never leak through the mapper.
    userFixture: 'fixture-a',
    tags: ['smoke']
  },
  {
    id: 'scenario-b',
    page: { path: '/b' },
    device: 'mobile',
    consent: 'rejected',
    country: 'FR',
    adsEnabled: false
  }
];

const RUN_ID = '20260101T000000Z-abc123';

const FAKE_SUMMARY: RunSummary = {
  runId: RUN_ID,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
  counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
  deterministicFailure: false
};

const FAKE_RUN_RESULT: RunResult = {
  runId: RUN_ID,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
  manifest: {
    toolVersion: '0.0.0',
    os: 'test',
    browser: { name: 'chromium', version: '1.0' },
    configHash: 'a'.repeat(8),
    scenarioIds: [],
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  results: [],
  counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
  deterministicFailure: false
};

function buildDeps(): WebApiDeps {
  const reader: ReportReaderDeps = {
    outputDir: '/fake/output',
    readdir: async (dir: string) => {
      expect(dir).toBe('/fake/output');
      return [RUN_ID];
    },
    readFile: async (path: string) => {
      if (path.includes('summary.json') && !path.includes(`${RUN_ID}/`)) {
        throw new Error('unexpected summary path');
      }
      if (path.endsWith(`${RUN_ID}/summary.json`)) {
        return JSON.stringify(FAKE_SUMMARY);
      }
      if (path.endsWith(`${RUN_ID}/manifest.json`)) {
        return JSON.stringify(FAKE_RUN_RESULT.manifest);
      }
      throw new Error(`unexpected read: ${path}`);
    },
    statIsDir: async () => true
  };

  return {
    resolveScenarios: () => ({ scenarios: FAKE_SCENARIOS }),
    reader
  };
}

test.describe('handleWebApiRequest', () => {
  test('GET /api/scenarios returns the explicit-allowlist ScenarioSummary shape', async () => {
    const deps = buildDeps();
    const response = await handleWebApiRequest('GET', '/api/scenarios', deps);

    expect(response?.status).toBe(200);
    expect(response?.contentType).toBe('application/json');
    const body = JSON.parse(response!.body);
    expect(body).toEqual({
      scenarios: [
        { id: 'scenario-a', page: { path: '/a', name: 'Page A' }, device: 'desktop', consent: 'accepted', country: 'ES', adsEnabled: true },
        { id: 'scenario-b', page: { path: '/b' }, device: 'mobile', consent: 'rejected', country: 'FR', adsEnabled: false }
      ]
    });
    // Extra fields (userFixture, tags) must never leak through the mapper.
    expect(response!.body).not.toContain('userFixture');
    expect(response!.body).not.toContain('fixture-a');
    expect(response!.body).not.toContain('tags');
  });

  test('non-GET on /api/scenarios returns 405', async () => {
    const deps = buildDeps();
    const response = await handleWebApiRequest('POST', '/api/scenarios', deps);
    expect(response?.status).toBe(405);
    expect(JSON.parse(response!.body)).toEqual({ error: 'method_not_allowed' });
  });

  test('GET /api/reports lists run summaries', async () => {
    const deps = buildDeps();
    const response = await handleWebApiRequest('GET', '/api/reports', deps);

    expect(response?.status).toBe(200);
    const body = JSON.parse(response!.body);
    expect(body).toEqual([FAKE_SUMMARY]);
  });

  test('non-GET on /api/reports returns 405', async () => {
    const deps = buildDeps();
    const response = await handleWebApiRequest('DELETE', '/api/reports', deps);
    expect(response?.status).toBe(405);
    expect(JSON.parse(response!.body)).toEqual({ error: 'method_not_allowed' });
  });

  test('GET /api/reports/:id returns the full RunResult for a known id', async () => {
    const deps = buildDeps();
    const response = await handleWebApiRequest('GET', `/api/reports/${RUN_ID}`, deps);

    expect(response?.status).toBe(200);
    const body = JSON.parse(response!.body);
    expect(body.runId).toBe(RUN_ID);
    expect(body.counts).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 });
  });

  test('GET /api/reports/:id with an unknown id returns 404, never a 500 or a leaked path', async () => {
    const deps = buildDeps();
    const response = await handleWebApiRequest('GET', '/api/reports/does-not-exist', deps);

    expect(response?.status).toBe(404);
    expect(JSON.parse(response!.body)).toEqual({ error: 'not_found' });
    expect(response!.body).not.toContain('/fake/output');
  });

  test('non-GET on /api/reports/:id returns 405', async () => {
    const deps = buildDeps();
    const response = await handleWebApiRequest('POST', `/api/reports/${RUN_ID}`, deps);
    expect(response?.status).toBe(405);
    expect(JSON.parse(response!.body)).toEqual({ error: 'method_not_allowed' });
  });

  test('an unrelated /api path returns undefined (fallthrough to handleApiRequest)', async () => {
    const deps = buildDeps();
    const response = await handleWebApiRequest('GET', '/api/x', deps);
    expect(response).toBeUndefined();
  });

  test('a non-/api path returns undefined', async () => {
    const deps = buildDeps();
    const response = await handleWebApiRequest('GET', '/', deps);
    expect(response).toBeUndefined();
  });
});
