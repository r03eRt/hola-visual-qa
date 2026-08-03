import { test, expect } from '@playwright/test';
import { handleApiRequest } from '../../src/dashboard/api-router.js';
import { JobStore } from '../../src/dashboard/jobs.js';
import type { RunControllerDeps } from '../../src/dashboard/run-controller.js';
import type { ProjectConfig } from '../../src/config/schema.js';
import type { Scenario } from '../../src/domain/index.js';
import type { RunResult } from '../../src/orchestrator/index.js';

/**
 * Hermetic unit tests for the async `/api/*` dashboard dispatcher
 * (docs/features/local-dashboard-runner/SPEC.md). No real fs/net/spawn — the
 * scenario resolver, clock, id generator and `executeRun` are all injected
 * fakes so job settlement can be driven deterministically from the test.
 */

const FAKE_CONFIG = {} as ProjectConfig;

const FAKE_SCENARIOS: Scenario[] = [
  { id: 'scenario-a', page: { path: '/a' }, device: 'desktop', consent: 'accepted', country: 'ES', adsEnabled: true },
  { id: 'scenario-b', page: { path: '/b' }, device: 'desktop', consent: 'accepted', country: 'ES', adsEnabled: true },
  { id: 'scenario-c', page: { path: '/c' }, device: 'mobile', consent: 'rejected', country: 'ES', adsEnabled: false }
];

function fakeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runId: 'run-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    manifest: {
      toolVersion: '0.0.0',
      os: 'test',
      browser: { name: 'chromium', version: '1.0' },
      configHash: 'hash',
      scenarioIds: FAKE_SCENARIOS.map((scenario) => scenario.id),
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    results: [],
    counts: { passed: 3, failed: 0, skipped: 0, total: 3 },
    deterministicFailure: false,
    ...overrides
  };
}

interface ControllableExecuteRun {
  deps: RunControllerDeps;
  resolve: (result: RunResult) => void;
  reject: (error: unknown) => void;
}

function buildDeps(): ControllableExecuteRun {
  let resolveFn!: (result: RunResult) => void;
  let rejectFn!: (error: unknown) => void;

  const executeRun = () =>
    new Promise<RunResult>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

  let tick = 0;
  const deps: RunControllerDeps = {
    resolveScenarios: () => ({ config: FAKE_CONFIG, scenarios: FAKE_SCENARIOS }),
    executeRun,
    store: new JobStore(),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, tick++, 0)),
    generateJobId: (now) => `job-${now.toISOString()}`
  };

  return { deps, resolve: (result) => resolveFn(result), reject: (error) => rejectFn(error) };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test.describe('handleApiRequest', () => {
  test('returns undefined for non-/api paths, falling back to the static router', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest('GET', '/', undefined, deps);
    expect(response).toBeUndefined();
  });

  test('POST /api/runs with no body starts a run over all planned scenarios', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest('POST', '/api/runs', undefined, deps);

    expect(response?.status).toBe(202);
    const body = JSON.parse(response!.body);
    expect(body.status).toBe('running');
    expect(body.scenarioIds).toEqual(['scenario-a', 'scenario-b', 'scenario-c']);
  });

  test('POST /api/runs with {} starts a run over all planned scenarios', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest('POST', '/api/runs', '{}', deps);

    expect(response?.status).toBe(202);
    const body = JSON.parse(response!.body);
    expect(body.scenarioIds).toEqual(['scenario-a', 'scenario-b', 'scenario-c']);
  });

  test('POST /api/runs with a valid scenarioIds subset starts a run over just that subset', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest(
      'POST',
      '/api/runs',
      JSON.stringify({ scenarioIds: ['scenario-b'] }),
      deps
    );

    expect(response?.status).toBe(202);
    const body = JSON.parse(response!.body);
    expect(body.scenarioIds).toEqual(['scenario-b']);
  });

  test('POST /api/runs with an unknown scenario id returns 400', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest(
      'POST',
      '/api/runs',
      JSON.stringify({ scenarioIds: ['does-not-exist'] }),
      deps
    );

    expect(response?.status).toBe(400);
    expect(JSON.parse(response!.body)).toEqual({ error: 'invalid_scenario_selection' });
  });

  test('POST /api/runs while a run is already active returns 409', async () => {
    const { deps } = buildDeps();
    const first = await handleApiRequest('POST', '/api/runs', undefined, deps);
    expect(first?.status).toBe(202);

    const second = await handleApiRequest('POST', '/api/runs', undefined, deps);
    expect(second?.status).toBe(409);
    expect(JSON.parse(second!.body)).toEqual({ error: 'run_in_progress' });
  });

  test('POST /api/runs with invalid JSON returns 400', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest('POST', '/api/runs', '{ not json', deps);

    expect(response?.status).toBe(400);
    expect(JSON.parse(response!.body)).toEqual({ error: 'invalid_json' });
  });

  test('POST /api/runs with the wrong body shape returns 400', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest(
      'POST',
      '/api/runs',
      JSON.stringify({ scenarioIds: [1, 2] }),
      deps
    );

    expect(response?.status).toBe(400);
    expect(JSON.parse(response!.body)).toEqual({ error: 'invalid_body' });
  });

  test('GET /api/runs returns the job list', async () => {
    const { deps } = buildDeps();
    await handleApiRequest('POST', '/api/runs', undefined, deps);

    const response = await handleApiRequest('GET', '/api/runs', undefined, deps);
    expect(response?.status).toBe(200);
    const body = JSON.parse(response!.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].status).toBe('running');
  });

  test('GET /api/runs/:id reflects a running -> completed transition once executeRun resolves', async () => {
    const { deps, resolve } = buildDeps();
    const startResponse = await handleApiRequest('POST', '/api/runs', undefined, deps);
    const id = JSON.parse(startResponse!.body).id;

    const runningResponse = await handleApiRequest('GET', `/api/runs/${id}`, undefined, deps);
    expect(JSON.parse(runningResponse!.body).status).toBe('running');

    resolve(fakeRunResult());
    await flushMicrotasks();

    const completedResponse = await handleApiRequest('GET', `/api/runs/${id}`, undefined, deps);
    const completedBody = JSON.parse(completedResponse!.body);
    expect(completedBody.status).toBe('completed');
    expect(completedBody.summary).toEqual({
      runId: 'run-1',
      counts: { passed: 3, failed: 0, skipped: 0, total: 3 },
      deterministicFailure: false
    });
  });

  test('a rejecting executeRun settles the job as failed with a report-safe message (no path/secret leak)', async () => {
    const { deps, reject } = buildDeps();
    const startResponse = await handleApiRequest('POST', '/api/runs', undefined, deps);
    const id = JSON.parse(startResponse!.body).id;

    reject(new Error('boom at /Users/secret/path with apiKey=sk-live-abc123'));
    await flushMicrotasks();

    const response = await handleApiRequest('GET', `/api/runs/${id}`, undefined, deps);
    const body = JSON.parse(response!.body);

    expect(body.status).toBe('failed');
    expect(response!.body).not.toContain('/Users/secret/path');
    expect(response!.body).not.toContain('sk-live-abc123');
    expect(response!.body).not.toContain('apiKey=sk-live-abc123');
  });

  test('GET /api/runs/:id with an unknown id returns 404', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest('GET', '/api/runs/does-not-exist', undefined, deps);

    expect(response?.status).toBe(404);
    expect(JSON.parse(response!.body)).toEqual({ error: 'not_found' });
  });

  test('unsupported method on /api/runs returns 405', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest('DELETE', '/api/runs', undefined, deps);

    expect(response?.status).toBe(405);
    expect(JSON.parse(response!.body)).toEqual({ error: 'method_not_allowed' });
  });

  test('unsupported method on /api/runs/:id returns 405', async () => {
    const { deps } = buildDeps();
    const startResponse = await handleApiRequest('POST', '/api/runs', undefined, deps);
    const id = JSON.parse(startResponse!.body).id;

    const response = await handleApiRequest('DELETE', `/api/runs/${id}`, undefined, deps);
    expect(response?.status).toBe(405);
    expect(JSON.parse(response!.body)).toEqual({ error: 'method_not_allowed' });
  });

  test('unknown /api path returns 404', async () => {
    const { deps } = buildDeps();
    const response = await handleApiRequest('GET', '/api/does-not-exist', undefined, deps);

    expect(response?.status).toBe(404);
    expect(JSON.parse(response!.body)).toEqual({ error: 'not_found' });
  });
});
