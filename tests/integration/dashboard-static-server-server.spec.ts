import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboard } from '../../src/dashboard/server.js';
import { resolveDashboardConfig } from '../../src/dashboard/config.js';
import { JobStore } from '../../src/dashboard/jobs.js';
import type { RunControllerDeps } from '../../src/dashboard/run-controller.js';
import type { ProjectConfig } from '../../src/config/schema.js';
import type { RunResult, Scenario } from '../../src/domain/index.js';

/**
 * Integration test for the bounded static-file server
 * (docs/features/dashboard-web-ui/SPEC.md): starts the real `node:http`
 * dashboard server with `staticDeps` pointed at an `mkdtemp` directory
 * standing in for `web/dist`, writes a fake `index.html` and
 * `assets/app.js`, and exercises `GET /app`, `GET /app/assets/app.js`,
 * `GET /app/nope` over the network via global `fetch` — plus confirms
 * `/healthz` and `/runs` still behave exactly as before.
 */

function fakeRunControllerDeps(): RunControllerDeps {
  const scenarios: Scenario[] = [
    { id: 'home-desktop-accepted-es', page: { path: '/', name: 'Home' }, device: 'desktop', consent: 'accepted', country: 'ES', adsEnabled: true }
  ];
  return {
    resolveScenarios: () => ({ config: {} as ProjectConfig, scenarios }),
    executeRun: () => new Promise<RunResult>(() => {}),
    store: new JobStore(),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    generateJobId: () => 'job-1'
  };
}

test.describe('dashboard static-file server (real node:http, real fs)', () => {
  test('GET /app, /app/assets/app.js, /app/nope and unchanged routes all work over real HTTP', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hola-web-dist-'));
    try {
      const webDistDir = path.join(tempDir, 'dist');
      await mkdir(path.join(webDistDir, 'assets'), { recursive: true });
      await writeFile(path.join(webDistDir, 'index.html'), '<!doctype html><html><body>App</body></html>', 'utf8');
      await writeFile(path.join(webDistDir, 'assets', 'app.js'), 'console.log("app");', 'utf8');

      const config = resolveDashboardConfig({ host: '127.0.0.1', port: 0 });
      const handle = await startDashboard(config, {
        runDeps: fakeRunControllerDeps(),
        reportDeps: { reader: { outputDir: path.join(tempDir, 'reports') } },
        staticDeps: { webDistDir }
      });

      try {
        // GET /app -> index.html + CSP header
        const appResponse = await fetch(`${handle.url}/app`);
        expect(appResponse.status).toBe(200);
        expect(appResponse.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(appResponse.headers.get('content-security-policy')).toBe("default-src 'self'");
        expect(await appResponse.text()).toContain('<!doctype html>');

        // GET /app/assets/app.js -> text/javascript + CSP header
        const jsResponse = await fetch(`${handle.url}/app/assets/app.js`);
        expect(jsResponse.status).toBe(200);
        expect(jsResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
        expect(jsResponse.headers.get('content-security-policy')).toBe("default-src 'self'");
        expect(await jsResponse.text()).toBe('console.log("app");');

        // GET /app/nope -> 404
        const missingResponse = await fetch(`${handle.url}/app/nope`);
        expect(missingResponse.status).toBe(404);
        expect(await missingResponse.json()).toEqual({ error: 'not_found' });

        // POST /app -> 405
        const postResponse = await fetch(`${handle.url}/app`, { method: 'POST' });
        expect(postResponse.status).toBe(405);

        // Existing routes are unchanged.
        const healthzResponse = await fetch(`${handle.url}/healthz`);
        expect(healthzResponse.status).toBe(200);
        expect(await healthzResponse.text()).toBe('{"status":"ok"}');

        const rootResponse = await fetch(`${handle.url}/`);
        expect(rootResponse.status).toBe(200);
        expect(await rootResponse.text()).toContain('<!doctype html>');

        const runsResponse = await fetch(`${handle.url}/runs`);
        expect(runsResponse.status).toBe(200);
        expect(await runsResponse.text()).toContain('<!doctype html>');
      } finally {
        await handle.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
