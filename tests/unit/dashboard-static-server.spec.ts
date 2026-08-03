import { test, expect } from '@playwright/test';
import { handleStaticRequest, type StaticServerDeps } from '../../src/dashboard/static-server.js';

/**
 * Hermetic unit tests for the PURE bounded static-file server
 * (docs/features/dashboard-web-ui/SPEC.md). No real fs/net — `readFile` and
 * `fileExists` are injected in-memory fakes over a fake `web/dist` file map,
 * driven purely by string keys, never touching disk.
 */

const WEB_DIST_DIR = '/fake/web/dist';

const FAKE_FILES: Record<string, string> = {
  '/fake/web/dist/index.html': '<!doctype html><html><body>App</body></html>',
  '/fake/web/dist/assets/index-abc123.js': 'console.log("app");',
  '/fake/web/dist/assets/index-abc123.css': 'body { color: red; }'
};

function buildDeps(reads: string[] = []): StaticServerDeps {
  return {
    webDistDir: WEB_DIST_DIR,
    fileExists: async (path: string) => {
      reads.push(path);
      return Object.prototype.hasOwnProperty.call(FAKE_FILES, path);
    },
    readFile: async (path: string) => {
      reads.push(path);
      const content = FAKE_FILES[path];
      if (content === undefined) {
        throw new Error(`unexpected read: ${path}`);
      }
      return content;
    }
  };
}

test.describe('handleStaticRequest', () => {
  test('GET /app serves index.html with CSP header', async () => {
    const response = await handleStaticRequest('GET', '/app', buildDeps());
    expect(response?.status).toBe(200);
    expect(response?.contentType).toBe('text/html; charset=utf-8');
    expect(response?.body).toContain('<!doctype html>');
    expect(response?.headers).toEqual({ 'Content-Security-Policy': "default-src 'self'" });
  });

  test('GET /app/ serves index.html with CSP header', async () => {
    const response = await handleStaticRequest('GET', '/app/', buildDeps());
    expect(response?.status).toBe(200);
    expect(response?.contentType).toBe('text/html; charset=utf-8');
    expect(response?.headers).toEqual({ 'Content-Security-Policy': "default-src 'self'" });
  });

  test('GET /app/assets/index-abc123.js serves with the correct MIME + CSP header', async () => {
    const response = await handleStaticRequest('GET', '/app/assets/index-abc123.js', buildDeps());
    expect(response?.status).toBe(200);
    expect(response?.contentType).toBe('text/javascript; charset=utf-8');
    expect(response?.body).toBe('console.log("app");');
    expect(response?.headers).toEqual({ 'Content-Security-Policy': "default-src 'self'" });
  });

  test('GET /app/assets/index-abc123.css serves with the correct MIME + CSP header', async () => {
    const response = await handleStaticRequest('GET', '/app/assets/index-abc123.css', buildDeps());
    expect(response?.status).toBe(200);
    expect(response?.contentType).toBe('text/css; charset=utf-8');
    expect(response?.headers).toEqual({ 'Content-Security-Policy': "default-src 'self'" });
  });

  test('POST /app returns 405', async () => {
    const response = await handleStaticRequest('POST', '/app', buildDeps());
    expect(response?.status).toBe(405);
    expect(JSON.parse(response!.body)).toEqual({ error: 'method_not_allowed' });
  });

  test('POST /app/assets/index-abc123.js returns 405', async () => {
    const response = await handleStaticRequest('POST', '/app/assets/index-abc123.js', buildDeps());
    expect(response?.status).toBe(405);
  });

  test('GET missing file returns 404', async () => {
    const response = await handleStaticRequest('GET', '/app/does-not-exist.js', buildDeps());
    expect(response?.status).toBe(404);
    expect(JSON.parse(response!.body)).toEqual({ error: 'not_found' });
  });

  test('traversal via ".." segment returns 404 and never reads outside webDistDir', async () => {
    const reads: string[] = [];
    const response = await handleStaticRequest('GET', '/app/../secret.txt', buildDeps(reads));
    expect(response?.status).toBe(404);
    expect(reads).toEqual([]);
  });

  test('a segment containing an embedded traversal marker never escapes webDistDir', async () => {
    const reads: string[] = [];
    const response = await handleStaticRequest('GET', '/app/assets/..', buildDeps(reads));
    expect(response?.status).toBe(404);
    expect(reads).toEqual([]);
  });

  test('traversal via embedded separator segment returns 404 and never reads outside webDistDir', async () => {
    const reads: string[] = [];
    const response = await handleStaticRequest('GET', '/app/assets%2f..%2f..%2fsecret', buildDeps(reads));
    expect(response?.status).toBe(404);
    expect(reads.every((path) => path.startsWith(WEB_DIST_DIR))).toBe(true);
  });

  test('literal-percent-encoded traversal (%2e%2e) is never decoded and 404s', async () => {
    const reads: string[] = [];
    const response = await handleStaticRequest('GET', '/app/%2e%2e/%2e%2e/secret', buildDeps(reads));
    expect(response?.status).toBe(404);
    expect(reads.every((path) => path.startsWith(WEB_DIST_DIR))).toBe(true);
  });

  test('returns undefined for "/"', async () => {
    const response = await handleStaticRequest('GET', '/', buildDeps());
    expect(response).toBeUndefined();
  });

  test('returns undefined for "/runs"', async () => {
    const response = await handleStaticRequest('GET', '/runs', buildDeps());
    expect(response).toBeUndefined();
  });

  test('returns undefined for "/api/x"', async () => {
    const response = await handleStaticRequest('GET', '/api/x', buildDeps());
    expect(response).toBeUndefined();
  });
});
