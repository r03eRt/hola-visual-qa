import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboard } from '../../src/dashboard/server.js';
import { resolveDashboardConfig } from '../../src/dashboard/config.js';
import { JobStore } from '../../src/dashboard/jobs.js';
import type { RunControllerDeps } from '../../src/dashboard/run-controller.js';
import { ensureRunDir, ensureScenarioDir, writeManifest, writeScenarioResult, writeSummary } from '../../src/artifacts/writer.js';
import type { ProjectConfig } from '../../src/config/schema.js';
import type { RunManifest, RunResult, RunSummary, Scenario, ScenarioResult } from '../../src/domain/index.js';

/**
 * Integration test for the read-only web API
 * (docs/features/dashboard-web-api/SPEC.md): starts the real `node:http`
 * dashboard server with a real `ReportRouterDeps` pointed at an `mkdtemp`
 * output dir, persists one run via the REAL artifact writers, and exercises
 * `GET /api/scenarios`, `GET /api/reports`, `GET /api/reports/:id` (plus the
 * unchanged `/`, `/healthz`, `GET /api/runs`, `POST /api/runs`) over the
 * network via global `fetch`. `executeRun` is faked here (never resolves) so
 * the test only exercises HTTP wiring/status codes, not a real Playwright
 * run.
 */

const RUN_ID = '20260101T000000Z-abc123';
const SCENARIO_ID = 'home-desktop-accepted-es';

const FAKE_SCENARIOS: Scenario[] = [
  { id: SCENARIO_ID, page: { path: '/', name: 'Home' }, device: 'desktop', consent: 'accepted', country: 'ES', adsEnabled: true }
];

const MANIFEST: RunManifest = {
  toolVersion: '0.0.0',
  os: 'darwin arm64',
  browser: { name: 'chromium', version: '120.0' },
  configHash: 'a'.repeat(8),
  scenarioIds: [SCENARIO_ID],
  createdAt: '2026-01-01T00:00:00.000Z'
};

const SUMMARY: RunSummary = {
  runId: RUN_ID,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
  counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
  deterministicFailure: false
};

const SCENARIO_RESULT: ScenarioResult = {
  scenario: FAKE_SCENARIOS[0] as Scenario,
  status: 'passed',
  errors: [],
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:30.000Z',
  durationMs: 30_000
};

function fakeRunControllerDeps(): RunControllerDeps {
  return {
    resolveScenarios: () => ({ config: {} as ProjectConfig, scenarios: FAKE_SCENARIOS }),
    // Never settles: this test only asserts the 202 status/HTTP wiring, not
    // a real scenario execution.
    executeRun: () => new Promise<RunResult>(() => {}),
    store: new JobStore(),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    generateJobId: () => 'job-1'
  };
}

test.describe('dashboard web API server (real node:http, real fs)', () => {
  test('GET /api/scenarios, /api/reports, /api/reports/:id and unchanged routes all work over real HTTP', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hola-web-api-'));
    try {
      const outputDir = path.join(tempDir, 'reports');
      await ensureRunDir(outputDir, RUN_ID);
      await ensureScenarioDir(outputDir, RUN_ID, SCENARIO_ID);
      await writeManifest(outputDir, RUN_ID, MANIFEST);
      await writeSummary(outputDir, RUN_ID, SUMMARY);
      await writeScenarioResult(outputDir, RUN_ID, SCENARIO_ID, SCENARIO_RESULT);

      const config = resolveDashboardConfig({ host: '127.0.0.1', port: 0 });
      const handle = await startDashboard(config, {
        runDeps: fakeRunControllerDeps(),
        reportDeps: { reader: { outputDir } }
      });

      try {
        // GET /api/scenarios
        const scenariosResponse = await fetch(`${handle.url}/api/scenarios`);
        expect(scenariosResponse.status).toBe(200);
        expect(scenariosResponse.headers.get('content-type')).toContain('application/json');
        const scenariosBody = await scenariosResponse.json();
        expect(Array.isArray(scenariosBody.scenarios)).toBe(true);
        expect(scenariosBody.scenarios.length).toBeGreaterThan(0);
        expect(scenariosBody.scenarios).toEqual([
          { id: SCENARIO_ID, page: { path: '/', name: 'Home' }, device: 'desktop', consent: 'accepted', country: 'ES', adsEnabled: true }
        ]);

        // Non-GET on /api/scenarios -> 405
        const scenariosMethodResponse = await fetch(`${handle.url}/api/scenarios`, { method: 'POST' });
        expect(scenariosMethodResponse.status).toBe(405);

        // GET /api/reports lists the persisted run
        const reportsResponse = await fetch(`${handle.url}/api/reports`);
        expect(reportsResponse.status).toBe(200);
        const reportsBody = await reportsResponse.json();
        expect(Array.isArray(reportsBody)).toBe(true);
        expect(reportsBody).toEqual([SUMMARY]);

        // GET /api/reports/:id returns the RunResult with matching counts
        const reportResponse = await fetch(`${handle.url}/api/reports/${RUN_ID}`);
        expect(reportResponse.status).toBe(200);
        const reportBody = await reportResponse.json();
        expect(reportBody.runId).toBe(RUN_ID);
        expect(reportBody.counts).toEqual(SUMMARY.counts);
        expect(reportBody.results).toHaveLength(1);
        expect(reportBody.results[0].scenario.id).toBe(SCENARIO_ID);

        // Unknown id -> 404, never a leaked path
        const unknownReportResponse = await fetch(`${handle.url}/api/reports/does-not-exist`);
        expect(unknownReportResponse.status).toBe(404);
        expect(await unknownReportResponse.text()).not.toContain(outputDir);

        // The scenario ids from /api/scenarios are exactly those POST /api/runs accepts.
        const runResponse = await fetch(`${handle.url}/api/runs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scenarioIds: [SCENARIO_ID] })
        });
        expect(runResponse.status).toBe(202);

        // Existing routes are unchanged.
        const rootResponse = await fetch(`${handle.url}/`);
        expect(rootResponse.status).toBe(200);
        expect(await rootResponse.text()).toContain('<!doctype html>');

        const healthzResponse = await fetch(`${handle.url}/healthz`);
        expect(healthzResponse.status).toBe(200);
        expect(await healthzResponse.text()).toBe('{"status":"ok"}');

        const listRunsResponse = await fetch(`${handle.url}/api/runs`);
        expect(listRunsResponse.status).toBe(200);
        const listRunsBody = await listRunsResponse.json();
        expect(Array.isArray(listRunsBody)).toBe(true);
        expect(listRunsBody).toHaveLength(1);
      } finally {
        await handle.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
