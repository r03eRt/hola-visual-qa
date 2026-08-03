import { test, expect } from '@playwright/test';
import { startDashboard } from '../../src/dashboard/server.js';
import { resolveDashboardConfig } from '../../src/dashboard/config.js';

/**
 * Integration test: starts the real `node:http` dashboard server on
 * `127.0.0.1:0` (ephemeral port) and exercises it over the network via
 * global `fetch` (SPEC-011 / local-dashboard-shell).
 */

test.describe('local dashboard server (real node:http)', () => {
  test('serves /healthz and / over a real loopback socket, then closes cleanly', async () => {
    const config = resolveDashboardConfig({ host: '127.0.0.1', port: 0 });
    const handle = await startDashboard(config);

    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);

      const healthzResponse = await fetch(`${handle.url}/healthz`);
      expect(healthzResponse.status).toBe(200);
      expect(healthzResponse.headers.get('content-type')).toBe('application/json');
      expect(await healthzResponse.text()).toBe('{"status":"ok"}');

      const rootResponse = await fetch(`${handle.url}/`);
      expect(rootResponse.status).toBe(200);
      expect(rootResponse.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const rootBody = await rootResponse.text();
      expect(rootBody).toContain('<!doctype html>');
      expect(rootBody).toContain('Local Visual QA dashboard');
    } finally {
      await handle.close();
    }
  });
});
