import { z } from 'zod';
import type { DashboardResponse } from './router.js';
import { startRun, type RunControllerDeps } from './run-controller.js';
import type { RunJob } from './jobs.js';

/**
 * Async `/api/*` dispatcher for the local dashboard's run endpoints
 * (docs/features/local-dashboard-runner/SPEC.md). Returns `undefined` for any
 * path that does not start with `/api/` so the `node:http` server falls back
 * to #30's PURE static router unchanged.
 */

const StartRunBodySchema = z
  .object({
    scenarioIds: z.array(z.string().min(1)).min(1).max(1000).optional()
  })
  .strict();

const RUN_BY_ID_PATTERN = /^\/api\/runs\/([^/]+)$/;

function json(status: number, body: unknown): DashboardResponse {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function notFound(): DashboardResponse {
  return json(404, { error: 'not_found' });
}

function methodNotAllowed(): DashboardResponse {
  return json(405, { error: 'method_not_allowed' });
}

function jobSummary(job: RunJob): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
    scenarioIds: job.scenarioIds,
    ...(job.summary !== undefined ? { summary: job.summary } : {}),
    ...(job.error !== undefined ? { error: job.error } : {})
  };
}

async function handleStartRun(body: string | undefined, deps: RunControllerDeps): Promise<DashboardResponse> {
  const raw = body === undefined || body.trim() === '' ? {} : body;

  let parsed: unknown;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json(400, { error: 'invalid_json' });
    }
  } else {
    parsed = raw;
  }

  const validation = StartRunBodySchema.safeParse(parsed);
  if (!validation.success) {
    return json(400, { error: 'invalid_body' });
  }

  const outcome = await startRun(validation.data, deps);

  if (outcome.status === 202 && outcome.job) {
    return json(202, jobSummary(outcome.job));
  }

  return json(outcome.status, { error: outcome.error ?? 'unknown_error' });
}

function handleListRuns(deps: RunControllerDeps): DashboardResponse {
  return json(200, deps.store.list().map(jobSummary));
}

function handleGetRun(id: string, deps: RunControllerDeps): DashboardResponse {
  const job = deps.store.get(id);
  if (!job) {
    return json(404, { error: 'not_found' });
  }
  return json(200, jobSummary(job));
}

export async function handleApiRequest(
  method: string,
  path: string,
  body: string | undefined,
  deps: RunControllerDeps
): Promise<DashboardResponse | undefined> {
  if (!path.startsWith('/api/')) {
    return undefined;
  }

  if (path === '/api/runs') {
    if (method === 'POST') {
      return handleStartRun(body, deps);
    }
    if (method === 'GET') {
      return handleListRuns(deps);
    }
    return methodNotAllowed();
  }

  const match = RUN_BY_ID_PATTERN.exec(path);
  if (match) {
    const id = match[1] as string;
    if (method === 'GET') {
      return handleGetRun(id, deps);
    }
    return methodNotAllowed();
  }

  return notFound();
}
