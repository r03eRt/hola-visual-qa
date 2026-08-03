/**
 * PURE renderer for the read-only report viewer (#32 /
 * docs/features/local-dashboard-report-viewer/SPEC.md). No fs/Date/random;
 * no `<script>`, no CDN, no `<img>` — every dynamic value is routed through
 * `escapeHtml`/`escapeAttribute` from ../reporting/html/escape.js.
 */

import type { ReportModel, ScenarioReportRow } from '../reporting/html/report-model.js';
import { escapeAttribute, escapeHtml } from '../reporting/html/escape.js';
import type { RunSummary } from '../domain/index.js';

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; background: #f7f7f9; color: #1c1c1e; }
  h1, h2 { margin-top: 0; }
  a { color: #1d4ed8; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-weight: 600; }
  .badge-pass { background: #d1f5d3; color: #14532d; }
  .badge-fail { background: #fbd5d5; color: #7f1d1d; }
  header.run-header { background: #fff; border: 1px solid #e2e2e6; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
  .counts span { margin-right: 12px; }
  section { background: #fff; border: 1px solid #e2e2e6; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 14px; }
  .status-passed { color: #14532d; }
  .status-failed { color: #7f1d1d; }
  .status-skipped { color: #92400e; }
  .empty { color: #555; font-style: italic; }
`;

function badge(deterministicFailure: boolean): string {
  const cls = deterministicFailure ? 'badge-fail' : 'badge-pass';
  const text = deterministicFailure ? 'FAIL' : 'PASS';
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** `GET /runs` — table of persisted runs, newest first. */
export function renderRunListPage(runs: readonly RunSummary[]): string {
  const rows =
    runs.length === 0
      ? '<tr><td colspan="8" class="empty">No runs found.</td></tr>'
      : runs
          .map((run) => {
            const href = `/runs/${escapeAttribute(run.runId)}`;
            return `
              <tr>
                <td><a href="${href}">${escapeHtml(run.runId)}</a></td>
                <td>${escapeHtml(run.startedAt)}</td>
                <td>${escapeHtml(run.finishedAt)}</td>
                <td>${escapeHtml(String(run.counts.passed))}</td>
                <td>${escapeHtml(String(run.counts.failed))}</td>
                <td>${escapeHtml(String(run.counts.skipped))}</td>
                <td>${escapeHtml(String(run.counts.total))}</td>
                <td>${badge(run.deterministicFailure)}</td>
              </tr>
            `;
          })
          .join('');

  const body = `
    <h1>Visual QA runs</h1>
    <section>
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Started</th>
            <th>Finished</th>
            <th>Passed</th>
            <th>Failed</th>
            <th>Skipped</th>
            <th>Total</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;

  return page('Visual QA runs', body);
}

function renderScenarioRow(row: ScenarioReportRow): string {
  const errorCell =
    row.category !== undefined || row.message !== undefined
      ? `${row.category !== undefined ? escapeHtml(row.category) : ''}${
          row.message !== undefined ? ` — ${escapeHtml(row.message)}` : ''
        }`
      : '';

  return `
    <tr>
      <td>${escapeHtml(row.scenarioId)}</td>
      <td>${escapeHtml(row.page)}${row.pageName !== undefined ? ` (${escapeHtml(row.pageName)})` : ''}</td>
      <td>${escapeHtml(row.device)}</td>
      <td>${escapeHtml(row.consent)}</td>
      <td>${escapeHtml(row.country)}</td>
      <td>${escapeHtml(String(row.adsEnabled))}</td>
      <td class="status-${escapeAttribute(row.status)}">${escapeHtml(row.status)}</td>
      <td>${errorCell}</td>
    </tr>
  `;
}

/**
 * `GET /runs/:id` — summary header + per-scenario verdict table. Reuses
 * `buildReportModel(run)` for the view model. Deliberately does NOT render
 * `row.artifacts` — no `<img>`, no artifact triplets.
 */
export function renderRunReportPage(model: ReportModel): string {
  const rows =
    model.rows.length === 0
      ? '<tr><td colspan="8" class="empty">No scenarios were run.</td></tr>'
      : model.rows.map((row) => renderScenarioRow(row)).join('');

  const body = `
    <p><a href="/runs">&larr; All runs</a></p>
    <header class="run-header">
      <h1>Run ${escapeHtml(model.runId)}</h1>
      <p>${badge(model.deterministicFailure)}</p>
      <p class="counts">
        <span>Total: ${escapeHtml(String(model.counts.total))}</span>
        <span>Passed: ${escapeHtml(String(model.counts.passed))}</span>
        <span>Failed: ${escapeHtml(String(model.counts.failed))}</span>
        <span>Skipped: ${escapeHtml(String(model.counts.skipped))}</span>
      </p>
      <p>
        Tool: ${escapeHtml(model.tool.version)} &middot;
        OS: ${escapeHtml(model.tool.os)} &middot;
        Browser: ${escapeHtml(model.tool.browser)}
      </p>
      <p>Started: ${escapeHtml(model.startedAt)} &middot; Finished: ${escapeHtml(model.finishedAt)}</p>
    </header>
    <section>
      <h2>Scenarios</h2>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Page</th>
            <th>Device</th>
            <th>Consent</th>
            <th>Country</th>
            <th>Ads</th>
            <th>Status</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;

  return page(`Run ${model.runId}`, body);
}

/** Minimal escaped 404 page; never leaks a path/stack. */
export function render404Page(message: string): string {
  const body = `
    <h1>Not found</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="/runs">&larr; All runs</a></p>
  `;

  return page('Not found', body);
}
