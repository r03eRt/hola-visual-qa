import * as http from 'node:http';
import type { DashboardConfig } from './config.js';
import { handleDashboardRequest } from './router.js';

/**
 * IMPURE `node:http` bootstrap for the local dashboard (SPEC-011 /
 * local-dashboard-shell). This is the ONLY layer in `src/dashboard` allowed to
 * touch the network. It adapts each request to the PURE router's
 * `DashboardRequest`/`DashboardResponse` contract and writes the response —
 * it never reads the request body or the filesystem.
 */

export interface DashboardServerDeps {
  router?: typeof handleDashboardRequest;
}

export interface DashboardHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

export function createDashboardServer(
  config: DashboardConfig,
  deps: DashboardServerDeps = {}
): http.Server {
  const router = deps.router ?? handleDashboardRequest;

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const response = router({ method: req.method ?? 'GET', path: url.pathname });

    res.statusCode = response.status;
    res.setHeader('Content-Type', response.contentType);
    res.end(response.body);
  });
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

export async function startDashboard(config: DashboardConfig): Promise<DashboardHandle> {
  const server = createDashboardServer(config);

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
