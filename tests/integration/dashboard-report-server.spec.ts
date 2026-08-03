import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboard } from '../../src/dashboard/server.js';
import { resolveDashboardConfig } from '../../src/dashboard/config.js';
import { ensureRunDir, ensureScenarioDir, writeManifest, writeScenarioResult, writeSummary } from '../../src/artifacts/writer.js';
import type { RunManifest, RunSummary, ScenarioResult } from '../../src/domain/index.js';

/**
 * Integration test for the read-only report viewer (#32 /
 * docs/features/local-dashboard-report-viewer/SPEC.md): starts the real
 * `node:http` dashboard server with a real `ReportRouterDeps` pointed at an
 * `mkdtemp` output dir, persists one run via the REAL artifact writers
 * (src/artifacts/writer.ts — no fake fs here), and exercises `/runs` and
 * `/runs/:id` over the network via global `fetch`.
 */

const RUN_ID = '20260101T000000Z-abc123';

const MANIFEST: RunManifest = {
  toolVersion: '0.0.0',
  os: 'darwin arm64',
  browser: { name: 'chromium', version: '120.0' },
  configHash: 'a'.repeat(8),
  scenarioIds: ['home-desktop-accepted-es'],
  createdAt: '2026-01-01T00:00:00.000Z'
};

const SUMMARY: RunSummary = {
  runId: RUN_ID,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
  counts: { passed: 0, failed: 1, skipped: 0, total: 1 },
  deterministicFailure: true
};

const SCENARIO_RESULT: ScenarioResult = {
  scenario: {
    id: 'home-desktop-accepted-es',
    page: { path: '/', name: 'Home' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true
  },
  status: 'failed',
  errors: [
    {
      code: 'visual-diff',
      category: 'visual_regression',
      severity: 'error',
      message: 'diff exceeds threshold',
      phase: 'assertion',
      timestamp: '2026-01-01T00:00:30.000Z'
    }
  ],
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:30.000Z',
  durationMs: 30_000
};

test.describe('local dashboard report viewer server (real node:http, real fs)', () => {
  test('GET /runs lists a persisted run and GET /runs/:id renders its verdicts', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hola-report-viewer-'));
    try {
      const outputDir = path.join(tempDir, 'reports');
      await ensureRunDir(outputDir, RUN_ID);
      await ensureScenarioDir(outputDir, RUN_ID, 'home-desktop-accepted-es');
      await writeManifest(outputDir, RUN_ID, MANIFEST);
      await writeSummary(outputDir, RUN_ID, SUMMARY);
      await writeScenarioResult(outputDir, RUN_ID, 'home-desktop-accepted-es', SCENARIO_RESULT);

      const config = resolveDashboardConfig({ host: '127.0.0.1', port: 0 });
      const handle = await startDashboard(config, { reportDeps: { reader: { outputDir } } });

      try {
        const listResponse = await fetch(`${handle.url}/runs`);
        expect(listResponse.status).toBe(200);
        expect(listResponse.headers.get('content-type')).toContain('text/html');
        const listBody = await listResponse.text();
        expect(listBody).toContain(RUN_ID);
        expect(listBody).toContain(`href="/runs/${RUN_ID}"`);

        const detailResponse = await fetch(`${handle.url}/runs/${RUN_ID}`);
        expect(detailResponse.status).toBe(200);
        const detailBody = await detailResponse.text();
        expect(detailBody).toContain(RUN_ID);
        expect(detailBody).toContain('home-desktop-accepted-es');
        expect(detailBody).toContain('visual_regression');
        expect(detailBody).toContain('diff exceeds threshold');
        expect(detailBody).not.toContain('<img');
        expect(detailBody).not.toContain(outputDir);

        const unknownResponse = await fetch(`${handle.url}/runs/does-not-exist`);
        expect(unknownResponse.status).toBe(404);
        expect(await unknownResponse.text()).not.toContain(outputDir);

        const healthzResponse = await fetch(`${handle.url}/healthz`);
        expect(healthzResponse.status).toBe(200);
        expect(await healthzResponse.text()).toBe('{"status":"ok"}');

        const rootResponse = await fetch(`${handle.url}/`);
        expect(rootResponse.status).toBe(200);
        expect(await rootResponse.text()).toContain('<!doctype html>');
      } finally {
        await handle.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
