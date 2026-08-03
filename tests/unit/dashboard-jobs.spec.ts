import { test, expect } from '@playwright/test';
import { JobStore } from '../../src/dashboard/jobs.js';

/**
 * Hermetic unit tests for the PURE in-memory `JobStore`
 * (docs/features/local-dashboard-runner/SPEC.md). No fs/net/executeRun.
 */

test.describe('JobStore', () => {
  test('create starts a job in the running status', () => {
    const store = new JobStore();

    const job = store.create('job-1', '2026-01-01T00:00:00.000Z', ['scenario-a', 'scenario-b']);

    expect(job).toEqual({
      id: 'job-1',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      scenarioIds: ['scenario-a', 'scenario-b']
    });
  });

  test('complete transitions a running job to completed with a summary', () => {
    const store = new JobStore();
    store.create('job-1', '2026-01-01T00:00:00.000Z', ['scenario-a']);

    store.complete(
      'job-1',
      { runId: 'run-1', counts: { passed: 1, failed: 0, skipped: 0, total: 1 }, deterministicFailure: false },
      '2026-01-01T00:01:00.000Z'
    );

    const job = store.get('job-1');
    expect(job?.status).toBe('completed');
    expect(job?.finishedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(job?.summary).toEqual({
      runId: 'run-1',
      counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
      deterministicFailure: false
    });
  });

  test('fail transitions a running job to failed with a message', () => {
    const store = new JobStore();
    store.create('job-1', '2026-01-01T00:00:00.000Z', ['scenario-a']);

    store.fail('job-1', 'internal_error.assertion: something went wrong', '2026-01-01T00:01:00.000Z');

    const job = store.get('job-1');
    expect(job?.status).toBe('failed');
    expect(job?.finishedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(job?.error).toBe('internal_error.assertion: something went wrong');
  });

  test('complete throws when the job id is unknown', () => {
    const store = new JobStore();

    expect(() =>
      store.complete(
        'missing',
        { runId: 'run-1', counts: { passed: 0, failed: 0, skipped: 0, total: 0 }, deterministicFailure: false },
        '2026-01-01T00:01:00.000Z'
      )
    ).toThrow();
  });

  test('fail throws when the job id is unknown', () => {
    const store = new JobStore();

    expect(() => store.fail('missing', 'boom', '2026-01-01T00:01:00.000Z')).toThrow();
  });

  test('complete throws when the job is already settled', () => {
    const store = new JobStore();
    store.create('job-1', '2026-01-01T00:00:00.000Z', []);
    store.complete(
      'job-1',
      { runId: 'run-1', counts: { passed: 0, failed: 0, skipped: 0, total: 0 }, deterministicFailure: false },
      '2026-01-01T00:01:00.000Z'
    );

    expect(() =>
      store.complete(
        'job-1',
        { runId: 'run-2', counts: { passed: 0, failed: 0, skipped: 0, total: 0 }, deterministicFailure: false },
        '2026-01-01T00:02:00.000Z'
      )
    ).toThrow();
  });

  test('fail throws when the job is already settled', () => {
    const store = new JobStore();
    store.create('job-1', '2026-01-01T00:00:00.000Z', []);
    store.fail('job-1', 'boom', '2026-01-01T00:01:00.000Z');

    expect(() => store.fail('job-1', 'boom again', '2026-01-01T00:02:00.000Z')).toThrow();
  });

  test('hasActiveRun reflects any running job', () => {
    const store = new JobStore();
    expect(store.hasActiveRun()).toBe(false);

    store.create('job-1', '2026-01-01T00:00:00.000Z', []);
    expect(store.hasActiveRun()).toBe(true);

    store.complete(
      'job-1',
      { runId: 'run-1', counts: { passed: 0, failed: 0, skipped: 0, total: 0 }, deterministicFailure: false },
      '2026-01-01T00:01:00.000Z'
    );
    expect(store.hasActiveRun()).toBe(false);
  });

  test('get returns undefined for an unknown id', () => {
    const store = new JobStore();
    expect(store.get('missing')).toBeUndefined();
  });

  test('list returns jobs in insertion order', () => {
    const store = new JobStore();
    store.create('job-1', '2026-01-01T00:00:00.000Z', []);
    store.create('job-2', '2026-01-01T00:01:00.000Z', []);

    const jobs = store.list();
    expect(jobs.map((job) => job.id)).toEqual(['job-1', 'job-2']);
  });

  test('get and list return non-aliasing snapshots: mutating a returned job does not affect the store', () => {
    const store = new JobStore();
    store.create('job-1', '2026-01-01T00:00:00.000Z', ['scenario-a']);

    const viaGet = store.get('job-1');
    expect(viaGet).toBeDefined();
    if (viaGet) {
      viaGet.status = 'completed';
      viaGet.scenarioIds.push('injected');
    }

    const viaList = store.list()[0];
    expect(viaList).toBeDefined();
    if (viaList) {
      viaList.status = 'failed';
    }

    const fresh = store.get('job-1');
    expect(fresh?.status).toBe('running');
    expect(fresh?.scenarioIds).toEqual(['scenario-a']);
  });

  test('is deterministic given the same inputs', () => {
    const storeA = new JobStore();
    const storeB = new JobStore();

    storeA.create('job-1', '2026-01-01T00:00:00.000Z', ['scenario-a']);
    storeB.create('job-1', '2026-01-01T00:00:00.000Z', ['scenario-a']);

    expect(storeA.get('job-1')).toEqual(storeB.get('job-1'));
  });
});
