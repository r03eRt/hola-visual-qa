import { useState } from 'react';
import { LaunchView } from './components/LaunchView.js';
import { LiveStatusView } from './components/LiveStatusView.js';
import { RunsView } from './components/RunsView.js';
import { ReportView } from './components/ReportView.js';

type Tab = 'launch' | 'live' | 'runs' | 'report';

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('launch');
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [reportRunId, setReportRunId] = useState<string | undefined>(undefined);

  function openReport(runId: string): void {
    setReportRunId(runId);
    setTab('report');
  }

  function onRunStarted(newJobId: string): void {
    setJobId(newJobId);
    setTab('live');
  }

  return (
    <main>
      <h1>Visual QA dashboard</h1>
      <p>
        <a href="/">Back to the no-script shell</a>
      </p>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'launch'} onClick={() => setTab('launch')}>
          Launch
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'live'}
          disabled={jobId === undefined}
          onClick={() => setTab('live')}
        >
          Live status
        </button>
        <button type="button" role="tab" aria-selected={tab === 'runs'} onClick={() => setTab('runs')}>
          Runs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'report'}
          disabled={reportRunId === undefined}
          onClick={() => setTab('report')}
        >
          Report
        </button>
      </div>

      {tab === 'launch' ? <LaunchView onRunStarted={onRunStarted} /> : null}
      {tab === 'live' && jobId !== undefined ? <LiveStatusView jobId={jobId} onOpenReport={openReport} /> : null}
      {tab === 'runs' ? <RunsView onOpenReport={openReport} /> : null}
      {tab === 'report' && reportRunId !== undefined ? <ReportView runId={reportRunId} /> : null}
    </main>
  );
}
