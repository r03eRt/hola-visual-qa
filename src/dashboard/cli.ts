import { resolveDashboardConfig } from './config.js';
import { startDashboard } from './server.js';

/**
 * Tiny CLI entrypoint for the local dashboard (SPEC-011 /
 * local-dashboard-shell). Resolves config from defaults only and prints the
 * bound URL — no secret output.
 */

const config = resolveDashboardConfig();
const handle = await startDashboard(config);
console.log(`Local Visual QA dashboard listening at ${handle.url}`);
