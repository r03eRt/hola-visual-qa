import type { RunCounts } from '../domain/index.js';

/**
 * PURE in-memory async-run job model for the local dashboard
 * (docs/features/local-dashboard-runner/SPEC.md). No fs/net/executeRun —
 * this module only tracks job state transitions in a `Map`. Callers own the
 * clock and id generation; `JobStore` never reads `Date.now()`/random itself.
 */

export interface RunJobSummary {
  runId: string;
  counts: RunCounts;
  deterministicFailure: boolean;
}

export interface RunJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  scenarioIds: string[];
  summary?: RunJobSummary;
  error?: string;
}

function cloneJob(job: RunJob): RunJob {
  return {
    ...job,
    scenarioIds: [...job.scenarioIds],
    ...(job.summary !== undefined ? { summary: { ...job.summary, counts: { ...job.summary.counts } } } : {})
  };
}

/**
 * In-memory store over a `Map<string, RunJob>`. `get`/`list` always return
 * cloned snapshots so a caller mutating a returned job can never corrupt the
 * store's internal state.
 */
export class JobStore {
  private readonly jobs = new Map<string, RunJob>();

  create(id: string, startedAt: string, scenarioIds: readonly string[]): RunJob {
    const job: RunJob = {
      id,
      status: 'running',
      startedAt,
      scenarioIds: [...scenarioIds]
    };

    this.jobs.set(id, job);
    return cloneJob(job);
  }

  complete(id: string, summary: RunJobSummary, finishedAt: string): void {
    const job = this.jobs.get(id);

    if (!job) {
      throw new Error(`Cannot complete unknown job: ${id}`);
    }

    if (job.status !== 'running') {
      throw new Error(`Cannot complete job ${id}: already settled as ${job.status}`);
    }

    this.jobs.set(id, {
      ...job,
      status: 'completed',
      finishedAt,
      summary: { ...summary, counts: { ...summary.counts } }
    });
  }

  fail(id: string, message: string, finishedAt: string): void {
    const job = this.jobs.get(id);

    if (!job) {
      throw new Error(`Cannot fail unknown job: ${id}`);
    }

    if (job.status !== 'running') {
      throw new Error(`Cannot fail job ${id}: already settled as ${job.status}`);
    }

    this.jobs.set(id, {
      ...job,
      status: 'failed',
      finishedAt,
      error: message
    });
  }

  get(id: string): RunJob | undefined {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  /** Returns snapshots of every job in insertion order. */
  list(): RunJob[] {
    return Array.from(this.jobs.values()).map(cloneJob);
  }

  hasActiveRun(): boolean {
    for (const job of this.jobs.values()) {
      if (job.status === 'running') {
        return true;
      }
    }
    return false;
  }
}
