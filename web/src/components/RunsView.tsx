import { useEffect, useState } from 'react';
import { fetchReports, type RunSummary } from '../api.js';

export interface RunsViewProps {
  onOpenReport: (runId: string) => void;
}

export function RunsView({ onOpenReport }: RunsViewProps): JSX.Element {
  const [runs, setRuns] = useState<RunSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchReports()
      .then((result) => {
        if (!cancelled) {
          setRuns(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="error-text">Failed to load runs: {error}</p>;
  }

  if (runs === undefined) {
    return <p>Loading runs…</p>;
  }

  if (runs.length === 0) {
    return <p>No runs yet.</p>;
  }

  return (
    <div className="card">
      <h2>Past runs</h2>
      {runs.map((run) => (
        <div className="run-list-item" key={run.runId} onClick={() => onOpenReport(run.runId)}>
          <strong>{run.runId}</strong> — started {run.startedAt}, finished {run.finishedAt} — passed:{' '}
          {run.counts.passed}, failed: {run.counts.failed}, skipped: {run.counts.skipped}, total: {run.counts.total}
          {run.deterministicFailure ? ' (deterministic failure)' : ''}
        </div>
      ))}
    </div>
  );
}
