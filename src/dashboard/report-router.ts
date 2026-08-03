import type { DashboardResponse } from './router.js';
import { listRuns, readRun, type ReportReaderDeps } from './report-reader.js';
import { render404Page, renderRunListPage, renderRunReportPage } from './report-page.js';
import { buildReportModel } from '../reporting/html/report-model.js';

/**
 * PURE async dispatcher for the read-only report viewer (#32 /
 * docs/features/local-dashboard-report-viewer/SPEC.md). Returns `undefined`
 * for any path other than `/runs` or `/runs/:id` so the `node:http` server
 * falls back to the #30 static router unchanged (keeps `/`, `/healthz`, 404
 * intact). Never uses the raw request path for filesystem access — only the
 * captured `:id`, and only via `./report-reader.js`, which routes every disk
 * path through `../artifacts/paths.js`.
 */

export interface ReportRouterDeps {
  reader: ReportReaderDeps;
}

const RUN_BY_ID_PATTERN = /^\/runs\/([^/]+)$/;

function html(status: number, body: string): DashboardResponse {
  return { status, contentType: 'text/html; charset=utf-8', body };
}

function methodNotAllowed(): DashboardResponse {
  return { status: 405, contentType: 'application/json', body: '{"error":"method_not_allowed"}' };
}

export async function handleReportRequest(
  method: string,
  path: string,
  deps: ReportRouterDeps
): Promise<DashboardResponse | undefined> {
  if (path === '/runs') {
    if (method !== 'GET') {
      return methodNotAllowed();
    }
    const runs = await listRuns(deps.reader);
    return html(200, renderRunListPage(runs));
  }

  const match = RUN_BY_ID_PATTERN.exec(path);
  if (match) {
    if (method !== 'GET') {
      return methodNotAllowed();
    }

    const runId = match[1] as string;
    const run = await readRun(runId, deps.reader);
    if (run === undefined) {
      return html(404, render404Page('This run was not found.'));
    }

    const model = buildReportModel(run);
    return html(200, renderRunReportPage(model));
  }

  return undefined;
}
