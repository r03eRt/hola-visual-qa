import { useEffect, useState } from 'react';
import { fetchRun, isTerminalStatus, type RunJob } from '../api.js';

export interface LiveStatusViewProps {
  jobId: string;
  onOpenReport: (runId: string) => void;
}

const POLL_INTERVAL_MS = 1500;

export function LiveStatusView({ jobId, onOpenReport }: LiveStatusViewProps): JSX.Element {
  const [job, setJob] = useState<RunJob | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll(): Promise<void> {
      try {
        const result = await fetchRun(jobId);
        if (cancelled) {
          return;
        }
        setJob(result);
        if (!isTerminalStatus(result.status)) {
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [jobId]);

  if (error) {
    return <p className="error-text">Failed to fetch run status: {error}</p>;
  }

  if (job === undefined) {
    return <p>Loading run status…</p>;
  }

  const terminal = isTerminalStatus(job.status);

  return (
    <div className="card">
      <h2>Run {job.id}</h2>
      <p>
        Status: <span className={`status-badge status-${job.status}`}>{job.status}</span>
      </p>
      <p>Started: {job.startedAt}</p>
      {job.finishedAt !== undefined ? <p>Finished: {job.finishedAt}</p> : null}
      <p>Scenarios: {job.scenarioIds.join(', ')}</p>
      {job.summary !== undefined ? (
        <p>
          Counts — passed: {job.summary.counts.passed}, failed: {job.summary.counts.failed}, skipped:{' '}
          {job.summary.counts.skipped}, total: {job.summary.counts.total}
        </p>
      ) : null}
      {job.error !== undefined ? <p className="error-text">Error: {job.error}</p> : null}
      {!terminal ? <p>Polling for updates every {POLL_INTERVAL_MS / 1000}s…</p> : null}
      {terminal && job.summary !== undefined ? (
        <p>
          <button type="button" onClick={() => onOpenReport(job.summary!.runId)}>
            View report
          </button>
        </p>
      ) : null}
    </div>
  );
}
