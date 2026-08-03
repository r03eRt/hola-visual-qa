import { useEffect, useState } from 'react';
import { fetchReport, type RunResult } from '../api.js';

export interface ReportViewProps {
  runId: string;
}

export function ReportView({ runId }: ReportViewProps): JSX.Element {
  const [run, setRun] = useState<RunResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setRun(undefined);
    setError(undefined);
    fetchReport(runId)
      .then((result) => {
        if (!cancelled) {
          setRun(result);
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
  }, [runId]);

  if (error) {
    return <p className="error-text">Failed to load report: {error}</p>;
  }

  if (run === undefined) {
    return <p>Loading report…</p>;
  }

  return (
    <div className="card">
      <h2>Report {run.runId}</h2>
      <p>Started: {run.startedAt}</p>
      <p>Finished: {run.finishedAt}</p>
      <p>
        Counts — passed: {run.counts.passed}, failed: {run.counts.failed}, skipped: {run.counts.skipped}, total:{' '}
        {run.counts.total}
      </p>
      <h3>Scenario verdicts</h3>
      {run.results.map((result) => (
        <div className="scenario-row" key={result.scenario.id}>
          <span className={`status-badge status-${result.status}`}>{result.status}</span>{' '}
          <strong>{result.scenario.page.name ?? result.scenario.page.path}</strong> ({result.durationMs}ms)
          {result.errors.length > 0 ? <pre>{JSON.stringify(result.errors, null, 2)}</pre> : null}
        </div>
      ))}
    </div>
  );
}
