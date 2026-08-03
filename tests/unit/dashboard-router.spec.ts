import { test, expect } from '@playwright/test';
import { handleDashboardRequest } from '../../src/dashboard/router.js';

/**
 * Hermetic unit tests for the PURE local-dashboard router (SPEC-011 /
 * local-dashboard-shell). No fs/net/browser; asserts the fixed route
 * allowlist and that the shell page is self-contained.
 */

test.describe('handleDashboardRequest', () => {
  test('GET / returns a self-contained HTML shell page', () => {
    const response = handleDashboardRequest({ method: 'GET', path: '/' });

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('text/html; charset=utf-8');
    expect(response.body).toContain('<!doctype html>');
    expect(response.body).toContain('<style');
    expect(response.body).not.toContain('<script');
    expect(response.body).not.toContain('http://');
    expect(response.body).not.toContain('https://');
    expect(response.body).not.toContain('src="//');
  });

  test('GET /healthz returns status ok as exact JSON', () => {
    const response = handleDashboardRequest({ method: 'GET', path: '/healthz' });

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(response.body).toBe('{"status":"ok"}');
  });

  test('unknown path returns 404 not_found', () => {
    const response = handleDashboardRequest({ method: 'GET', path: '/does-not-exist' });

    expect(response.status).toBe(404);
    expect(response.contentType).toBe('application/json');
    expect(response.body).toBe('{"error":"not_found"}');
  });

  test('known path with a non-GET method returns 405 method_not_allowed', () => {
    const response = handleDashboardRequest({ method: 'POST', path: '/' });

    expect(response.status).toBe(405);
    expect(response.contentType).toBe('application/json');
    expect(response.body).toBe('{"error":"method_not_allowed"}');

    const healthzResponse = handleDashboardRequest({ method: 'DELETE', path: '/healthz' });
    expect(healthzResponse.status).toBe(405);
    expect(healthzResponse.body).toBe('{"error":"method_not_allowed"}');
  });

  test('no response body leaks secret-shaped or filesystem-path content', () => {
    const paths = ['/', '/healthz', '/../etc/passwd', '/unknown'];
    const methods = ['GET', 'POST', 'PUT', 'DELETE'];

    for (const path of paths) {
      for (const method of methods) {
        const response = handleDashboardRequest({ method, path });
        expect(response.body).not.toMatch(/api[-_]?key/i);
        expect(response.body).not.toMatch(/secret/i);
        expect(response.body).not.toMatch(/password/i);
        expect(response.body).not.toMatch(/\/(Users|home|etc)\//);
      }
    }
  });
});
