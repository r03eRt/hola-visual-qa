import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import type { DashboardResponse } from './router.js';

/**
 * Bounded static-file server for the React SPA (docs/features/dashboard-web-ui/SPEC.md).
 * PURE async dispatcher that only serves files rooted at `deps.webDistDir`.
 * Returns `undefined` for any path not under `/app` so the `node:http` server
 * falls through to the report/no-script routers unchanged. Mirrors the
 * traversal guards in `../artifacts/paths.ts` (`assertSafeSegment`/
 * `assertInside`) instead of ever passing the raw request path to `fs`.
 */

export interface StaticServerDeps {
  webDistDir: string;
  readFile?: (path: string) => Promise<string>;
  fileExists?: (path: string) => Promise<boolean>;
}

const CSP_HEADER = { 'Content-Security-Policy': "default-src 'self'" };

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

function notFound(): DashboardResponse {
  return { status: 404, contentType: 'application/json', body: '{"error":"not_found"}', headers: { ...CSP_HEADER } };
}

function methodNotAllowed(): DashboardResponse {
  return {
    status: 405,
    contentType: 'application/json',
    body: '{"error":"method_not_allowed"}',
    headers: { ...CSP_HEADER }
  };
}

async function defaultReadFile(filePath: string): Promise<string> {
  return fsReadFile(filePath, 'utf8');
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await fsReadFile(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rejects segments that would escape their parent directory: absolute
 * paths, empty segments, `.`/`..` traversal, and embedded path separators
 * in a single segment. Mirrors `assertSafeSegment` in `../artifacts/paths.ts`.
 */
function isSafeSegment(segment: string): boolean {
  if (!segment || segment.length === 0) {
    return false;
  }
  if (segment === '.' || segment === '..') {
    return false;
  }
  if (path.isAbsolute(segment)) {
    return false;
  }
  if (/[\\/]/.test(segment)) {
    return false;
  }
  return true;
}

/**
 * Resolves `subPath` (e.g. `assets/index-abc.js`) against `webDistDir`,
 * rejecting any traversal/absolute/unsafe segment and re-verifying with an
 * `assertInside`-style `path.relative` check. Returns `undefined` when
 * unsafe rather than ever calling `fs` with an unguarded path.
 */
function resolveSafePath(webDistDir: string, subPath: string): string | undefined {
  const segments = subPath.split('/').filter((segment) => segment.length > 0 || subPath === '');

  // subPath === '' means the index itself; otherwise every segment must be safe.
  if (subPath !== '' && segments.some((segment) => !isSafeSegment(segment))) {
    return undefined;
  }

  const root = path.resolve(webDistDir);
  const candidate = subPath === '' ? path.join(root, 'index.html') : path.resolve(root, ...segments);

  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }

  return candidate;
}

export async function handleStaticRequest(
  method: string,
  requestPath: string,
  deps: StaticServerDeps
): Promise<DashboardResponse | undefined> {
  if (requestPath !== '/app' && !requestPath.startsWith('/app/')) {
    return undefined;
  }

  if (method !== 'GET') {
    return methodNotAllowed();
  }

  const readFile = deps.readFile ?? defaultReadFile;
  const fileExists = deps.fileExists ?? defaultFileExists;

  const subPath = requestPath === '/app' || requestPath === '/app/' ? '' : requestPath.slice('/app/'.length);

  const resolved = resolveSafePath(deps.webDistDir, subPath);
  if (resolved === undefined) {
    return notFound();
  }

  const exists = await fileExists(resolved);
  if (!exists) {
    return notFound();
  }

  let body: string;
  try {
    body = await readFile(resolved);
  } catch {
    return notFound();
  }

  return {
    status: 200,
    contentType: mimeFor(resolved),
    body,
    headers: { ...CSP_HEADER }
  };
}
