import { renderShellPage } from './shell-page.js';

/**
 * PURE local-dashboard request router (SPEC-011 / local-dashboard-shell). No
 * fs/net/Date/random. Matches a FIXED route allowlist and never uses the
 * request path to read the filesystem, eliminating any path-traversal
 * surface. Unknown paths are a flat 404 regardless of method.
 */

export interface DashboardRequest {
  method: string;
  path: string;
}

export interface DashboardResponse {
  status: number;
  contentType: string;
  body: string;
}

const KNOWN_PATHS: ReadonlySet<string> = new Set(['/', '/healthz']);

function notFound(): DashboardResponse {
  return { status: 404, contentType: 'application/json', body: '{"error":"not_found"}' };
}

function methodNotAllowed(): DashboardResponse {
  return { status: 405, contentType: 'application/json', body: '{"error":"method_not_allowed"}' };
}

export function handleDashboardRequest(req: DashboardRequest): DashboardResponse {
  if (!KNOWN_PATHS.has(req.path)) {
    return notFound();
  }

  if (req.method !== 'GET') {
    return methodNotAllowed();
  }

  if (req.path === '/') {
    return { status: 200, contentType: 'text/html; charset=utf-8', body: renderShellPage() };
  }

  // req.path === '/healthz'
  return { status: 200, contentType: 'application/json', body: '{"status":"ok"}' };
}
