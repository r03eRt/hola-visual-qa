import { useEffect, useState } from 'react';
import { fetchScenarios, startRun, type ScenarioSummary } from '../api.js';

export interface LaunchViewProps {
  onRunStarted: (jobId: string) => void;
}

export function LaunchView({ onRunStarted }: LaunchViewProps): JSX.Element {
  const [scenarios, setScenarios] = useState<ScenarioSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchScenarios()
      .then((result) => {
        if (!cancelled) {
          setScenarios(result);
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

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(undefined);
    try {
      const scenarioIds = selected.size > 0 ? Array.from(selected) : undefined;
      const job = await startRun(scenarioIds);
      onRunStarted(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return <p className="error-text">Failed to load scenarios: {error}</p>;
  }

  if (scenarios === undefined) {
    return <p>Loading scenarios…</p>;
  }

  return (
    <div className="card">
      <h2>Launch a run</h2>
      <p>Select scenarios to run, or leave all unchecked to run every planned scenario.</p>
      <div>
        {scenarios.map((scenario) => (
          <div className="scenario-row" key={scenario.id}>
            <input
              type="checkbox"
              id={`scenario-${scenario.id}`}
              checked={selected.has(scenario.id)}
              onChange={() => toggle(scenario.id)}
            />
            <label htmlFor={`scenario-${scenario.id}`}>
              {scenario.page.name ?? scenario.page.path} — {scenario.device}, {scenario.consent}, {scenario.country}
              {scenario.adsEnabled ? ', ads' : ''}
            </label>
          </div>
        ))}
      </div>
      <p>
        <button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? 'Starting…' : 'Start run'}
        </button>
      </p>
    </div>
  );
}
