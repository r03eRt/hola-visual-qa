import * as http from 'node:http';
import type { DashboardConfig } from './config.js';
import { handleDashboardRequest } from './router.js';
import { handleApiRequest } from './api-router.js';
import { handleWebApiRequest, type WebApiDeps } from './web-api-router.js';
import { handleReportRequest, type ReportRouterDeps } from './report-router.js';
import { JobStore } from './jobs.js';
import type { RunControllerDeps } from './run-controller.js';
import { loadConfig } from '../config/load-config.js';
import { planScenarios } from '../scenarios/index.js';
import { executeRun } from '../orchestrator/index.js';
import { newRunId } from '../artifacts/run-id.js';

/**
 * IMPURE `node:http` bootstrap for the local dashboard (SPEC-011 /
 * local-dashboard-shell, extended by docs/features/local-dashboard-runner/SPEC.md
 * for the async run API). This is the ONLY layer in `src/dashboard` allowed to
 * touch the network. Non-API requests adapt to the PURE router's
 * `DashboardRequest`/`DashboardResponse` contract unchanged and never read the
 * request body or the filesystem. `/api/*` requests are read with a hard body
 * size cap and dispatched to the async `handleApiRequest`.
 */

export interface DashboardServerDeps {
  router?: typeof handleDashboardRequest;
  runDeps?: RunControllerDeps;
  reportDeps?: ReportRouterDeps;
}

/** Hard cap on `/api/*` request bodies; larger bodies are rejected with 413. */
const MAX_API_BODY_BYTES = 64 * 1024;

function defaultRunControllerDeps(): RunControllerDeps {
  return {
    resolveScenarios: () => {
      const config = loadConfig();
      return { config, scenarios: planScenarios(config).scenarios };
    },
    executeRun: (request, deps) => executeRun(request, deps as Parameters<typeof executeRun>[1]),
    store: new JobStore(),
    now: () => new Date(),
    generateJobId: (now) => newRunId(now)
  };
}

function defaultReportRouterDeps(): ReportRouterDeps {
  return { reader: { outputDir: loadConfig().artifacts.outputDir } };
}

export interface DashboardHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

function writeResponse(res: http.ServerResponse, response: { status: number; contentType: string; body: string }): void {
  res.statusCode = response.status;
  res.setHeader('Content-Type', response.contentType);
  res.end(response.body);
}

export function createDashboardServer(
  config: DashboardConfig,
  deps: DashboardServerDeps = {}
): http.Server {
  const router = deps.router ?? handleDashboardRequest;
  // Resolved ONCE per server so job state (and the scenario resolver) persists
  // across requests, rather than being rebuilt per request.
  const runDeps = deps.runDeps ?? defaultRunControllerDeps();
  // Resolved ONCE per server, from the committed config's artifacts.outputDir,
  // so the report reader is not re-derived per request.
  const reportDeps = deps.reportDeps ?? defaultReportRouterDeps();
  // Reuses the SAME resolveScenarios/reader as runDeps/reportDeps (per
  // docs/features/dashboard-web-api/SPEC.md) rather than re-deriving them,
  // so `/api/scenarios` ids always match what `POST /api/runs` accepts.
  const webApiDeps: WebApiDeps = { resolveScenarios: runDeps.resolveScenarios, reader: reportDeps.reader };

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (!url.pathname.startsWith('/api/')) {
      handleReportRequest(method, url.pathname, reportDeps)
        .then((reportResponse) => {
          if (reportResponse) {
            writeResponse(res, reportResponse);
            return;
          }
          const response = router({ method, path: url.pathname });
          writeResponse(res, response);
        })
        .catch(() => {
          writeResponse(res, { status: 500, contentType: 'application/json', body: '{"error":"internal_error"}' });
        });
      return;
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let rejected = false;

    req.on('data', (chunk: Buffer) => {
      if (rejected) {
        return;
      }

      receivedBytes += chunk.length;
      if (receivedBytes > MAX_API_BODY_BYTES) {
        rejected = true;
        writeResponse(res, { status: 413, contentType: 'application/json', body: '{"error":"payload_too_large"}' });
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (rejected) {
        return;
      }

      const body = Buffer.concat(chunks).toString('utf-8');

      handleWebApiRequest(method, url.pathname, webApiDeps)
        .then((webResponse) => {
          if (webResponse) {
            writeResponse(res, webResponse);
            return;
          }

          return handleApiRequest(method, url.pathname, body, runDeps).then((response) => {
            if (response) {
              writeResponse(res, response);
              return;
            }

            const fallback = router({ method, path: url.pathname });
            writeResponse(res, fallback);
          });
        })
        .catch(() => {
          writeResponse(res, { status: 500, contentType: 'application/json', body: '{"error":"internal_error"}' });
        });
    });
  });
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

export async function startDashboard(
  config: DashboardConfig,
  deps: DashboardServerDeps = {}
): Promise<DashboardHandle> {
  const server = createDashboardServer(config, deps);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;

  return {
    url: `http://${formatHost(config.host)}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}
