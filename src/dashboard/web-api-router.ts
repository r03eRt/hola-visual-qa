import type { DashboardResponse } from './router.js';
import { listRuns, readRun, type ReportReaderDeps } from './report-reader.js';
import type { Scenario } from '../domain/index.js';

/**
 * PURE async `/api/*` dispatcher for the dashboard's read-only web API
 * (docs/features/dashboard-web-api/SPEC.md): `GET /api/scenarios`,
 * `GET /api/reports` and `GET /api/reports/:id`. Returns `undefined` for any
 * other path so the `node:http` server falls back to #31's
 * `handleApiRequest` (which owns `/api/runs*`) unchanged. No fs/net itself —
 * all disk access happens inside the injected `reader`.
 */

export interface WebApiDeps {
  resolveScenarios: () => { scenarios: readonly Scenario[] };
  reader: ReportReaderDeps;
}

export interface ScenarioSummary {
  id: string;
  page: { path: string; name?: string };
  device: Scenario['device'];
  consent: Scenario['consent'];
  country: string;
  adsEnabled: boolean;
}

const REPORT_BY_ID_PATTERN = /^\/api\/reports\/([^/]+)$/;

function json(status: number, body: unknown): DashboardResponse {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function notFound(): DashboardResponse {
  return json(404, { error: 'not_found' });
}

function methodNotAllowed(): DashboardResponse {
  return json(405, { error: 'method_not_allowed' });
}

/** Explicit allowlist mapper — never leaks fields beyond this shape. */
function toScenarioSummary(scenario: Scenario): ScenarioSummary {
  return {
    id: scenario.id,
    page: {
      path: scenario.page.path,
      ...(scenario.page.name !== undefined ? { name: scenario.page.name } : {})
    },
    device: scenario.device,
    consent: scenario.consent,
    country: scenario.country,
    adsEnabled: scenario.adsEnabled
  };
}

function handleScenarios(deps: WebApiDeps): DashboardResponse {
  const { scenarios } = deps.resolveScenarios();
  return json(200, { scenarios: scenarios.map(toScenarioSummary) });
}

async function handleReportsList(deps: WebApiDeps): Promise<DashboardResponse> {
  const summaries = await listRuns(deps.reader);
  return json(200, summaries);
}

async function handleReportById(id: string, deps: WebApiDeps): Promise<DashboardResponse> {
  const result = await readRun(id, deps.reader);
  if (!result) {
    return notFound();
  }
  return json(200, result);
}

export async function handleWebApiRequest(
  method: string,
  path: string,
  deps: WebApiDeps
): Promise<DashboardResponse | undefined> {
  if (path === '/api/scenarios') {
    if (method !== 'GET') {
      return methodNotAllowed();
    }
    return handleScenarios(deps);
  }

  if (path === '/api/reports') {
    if (method !== 'GET') {
      return methodNotAllowed();
    }
    return handleReportsList(deps);
  }

  const match = REPORT_BY_ID_PATTERN.exec(path);
  if (match) {
    if (method !== 'GET') {
      return methodNotAllowed();
    }
    const id = match[1] as string;
    return handleReportById(id, deps);
  }

  return undefined;
}
