import { test, expect } from '@playwright/test';
import { startDashboard } from '../../src/dashboard/server.js';
import { resolveDashboardConfig } from '../../src/dashboard/config.js';
import { JobStore } from '../../src/dashboard/jobs.js';
import type { RunControllerDeps } from '../../src/dashboard/run-controller.js';
import type { ProjectConfig } from '../../src/config/schema.js';
import type { Scenario } from '../../src/domain/index.js';
import type { RunResult } from '../../src/orchestrator/index.js';

/**
 * Integration test: starts the real `node:http` dashboard server on
 * `127.0.0.1:0` with an INJECTED fake `executeRun` (never a real
 * spawn/browser) and exercises the async run API over the network via
 * global `fetch` (docs/features/local-dashboard-runner/SPEC.md).
 */

const FAKE_CONFIG = {} as ProjectConfig;
const FAKE_SCENARIOS: Scenario[] = [
  { id: 'scenario-a', page: { path: '/a' }, device: 'desktop', consent: 'accepted', country: 'ES', adsEnabled: true }
];

function fakeRunResult(): RunResult {
  return {
    runId: 'run-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    manifest: {
      toolVersion: '0.0.0',
      os: 'test',
      browser: { name: 'chromium', version: '1.0' },
      configHash: 'hash',
      scenarioIds: FAKE_SCENARIOS.map((scenario) => scenario.id),
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    results: [],
    counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
    deterministicFailure: false
  };
}

function buildRunDeps(): RunControllerDeps {
  let tick = 0;
  return {
    resolveScenarios: () => ({ config: FAKE_CONFIG, scenarios: FAKE_SCENARIOS }),
    executeRun: () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(fakeRunResult()), 25);
      }),
    store: new JobStore(),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, tick++, 0)),
    generateJobId: (now) => `job-${now.toISOString()}`
  };
}

test.describe('local dashboard runner server (real node:http, fake executeRun)', () => {
  test('POST /api/runs then poll GET /api/runs/:id until completed', async () => {
    const config = resolveDashboardConfig({ host: '127.0.0.1', port: 0 });
    const handle = await startDashboard(config, { runDeps: buildRunDeps() });

    try {
      const postResponse = await fetch(`${handle.url}/api/runs`, { method: 'POST' });
      expect(postResponse.status).toBe(202);
      const started = await postResponse.json();
      expect(started.status).toBe('running');
      expect(typeof started.id).toBe('string');

      let job = started;
      for (let attempt = 0; attempt < 50 && job.status === 'running'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const pollResponse = await fetch(`${handle.url}/api/runs/${started.id}`);
        expect(pollResponse.status).toBe(200);
        job = await pollResponse.json();
      }

      expect(job.status).toBe('completed');
      expect(job.summary).toEqual({
        runId: 'run-1',
        counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
        deterministicFailure: false
      });
    } finally {
      await handle.close();
    }
  });

  test('a POST body exceeding the 64KiB cap is rejected with 413', async () => {
    const config = resolveDashboardConfig({ host: '127.0.0.1', port: 0 });
    const handle = await startDashboard(config, { runDeps: buildRunDeps() });

    try {
      const oversizedBody = JSON.stringify({ scenarioIds: [ 'x'.repeat(70 * 1024) ] });
      const response = await fetch(`${handle.url}/api/runs`, {
        method: 'POST',
        body: oversizedBody
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: 'payload_too_large' });
    } finally {
      await handle.close();
    }
  });

  test('GET / and GET /healthz still behave as in #30', async () => {
    const config = resolveDashboardConfig({ host: '127.0.0.1', port: 0 });
    const handle = await startDashboard(config, { runDeps: buildRunDeps() });

    try {
      const healthzResponse = await fetch(`${handle.url}/healthz`);
      expect(healthzResponse.status).toBe(200);
      expect(await healthzResponse.text()).toBe('{"status":"ok"}');

      const rootResponse = await fetch(`${handle.url}/`);
      expect(rootResponse.status).toBe(200);
      expect(await rootResponse.text()).toContain('<!doctype html>');
    } finally {
      await handle.close();
    }
  });
});
