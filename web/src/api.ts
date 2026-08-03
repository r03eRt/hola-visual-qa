export interface ScenarioSummary {
  id: string;
  page: { path: string; name?: string };
  device: string;
  consent: string;
  country: string;
  adsEnabled: boolean;
}

export interface RunJobSummary {
  runId: string;
  counts: { passed: number; failed: number; skipped: number; total: number };
  deterministicFailure: boolean;
}

export interface RunJob {
  id: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  scenarioIds: string[];
  summary?: RunJobSummary;
  error?: string;
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  counts: { passed: number; failed: number; skipped: number; total: number };
  deterministicFailure: boolean;
}

export interface RunResult extends RunSummary {
  manifest: unknown;
  results: Array<{
    scenario: { id: string; page: { path: string; name?: string } };
    status: string;
    errors: unknown[];
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  }>;
}

/** Job statuses that mean the run is still in flight (see src/dashboard/jobs.ts). */
const NON_TERMINAL_STATUSES: ReadonlySet<string> = new Set(['queued', 'running']);

export function isTerminalStatus(status: string): boolean {
  return !NON_TERMINAL_STATUSES.has(status);
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchScenarios(): Promise<ScenarioSummary[]> {
  const response = await fetch('/api/scenarios');
  const body = await parseJsonOrThrow<{ scenarios: ScenarioSummary[] }>(response);
  return body.scenarios;
}

export async function startRun(scenarioIds: string[] | undefined): Promise<RunJob> {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(scenarioIds === undefined ? {} : { scenarioIds })
  });
  return parseJsonOrThrow<RunJob>(response);
}

export async function fetchRun(id: string): Promise<RunJob> {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
  return parseJsonOrThrow<RunJob>(response);
}

export async function fetchReports(): Promise<RunSummary[]> {
  const response = await fetch('/api/reports');
  return parseJsonOrThrow<RunSummary[]>(response);
}

export async function fetchReport(id: string): Promise<RunResult> {
  const response = await fetch(`/api/reports/${encodeURIComponent(id)}`);
  return parseJsonOrThrow<RunResult>(response);
}
