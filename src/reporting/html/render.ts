/**
 * Pure renderer producing one self-contained HTML document from a
 * `ReportModel` (SPEC-009 / docs/features/custom-html-report/SPEC.md). No
 * external/CDN resources, no `<script>`. EVERY interpolated dynamic value is
 * routed through `escapeHtml`/`escapeAttribute` — this is the only place the
 * report touches free-text (console/network/error/AI strings).
 */

import type { ReportModel, ScenarioReportRow } from './report-model.js';
import { escapeAttribute, escapeHtml } from './escape.js';

const AI_DISCLAIMER = 'AI analysis — informational only, not a pass/fail decision';

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; background: #f7f7f9; color: #1c1c1e; }
  h1, h2, h3 { margin-top: 0; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-weight: 600; }
  .badge-pass { background: #d1f5d3; color: #14532d; }
  .badge-fail { background: #fbd5d5; color: #7f1d1d; }
  header.run-header { background: #fff; border: 1px solid #e2e2e6; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
  .counts span { margin-right: 12px; }
  section { background: #fff; border: 1px solid #e2e2e6; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 14px; }
  .scenario-row { border: 1px solid #e2e2e6; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .status-passed { color: #14532d; }
  .status-failed { color: #7f1d1d; }
  .status-skipped { color: #92400e; }
  .triplet { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
  .triplet figure { margin: 0; width: 220px; }
  .triplet img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; }
  .triplet .missing { display: block; padding: 40px 8px; text-align: center; background: #f0f0f2; border: 1px dashed #ccc; border-radius: 4px; color: #777; font-size: 12px; }
  .ai-analysis { margin-top: 12px; background: #eef2ff; border: 2px dashed #6366f1; border-radius: 8px; padding: 12px 16px; }
  .ai-analysis .ai-label { font-weight: 700; color: #3730a3; text-transform: uppercase; font-size: 12px; letter-spacing: 0.02em; }
  .dims code { background: #f0f0f2; border-radius: 4px; padding: 1px 4px; }
`;

function renderHeader(model: ReportModel): string {
  const badgeClass = model.deterministicFailure ? 'badge-fail' : 'badge-pass';
  const badgeText = model.deterministicFailure ? 'FAIL (deterministic)' : 'PASS';

  return `
    <header class="run-header">
      <h1>Visual QA report — ${escapeHtml(model.runId)}</h1>
      <p><span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span></p>
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
  `;
}

function renderGroups(model: ReportModel): string {
  if (model.groups.length === 0) {
    return '';
  }

  const rows = model.groups
    .map((group) => {
      const categories = Array.from(new Set(group.failures.map((f) => f.category))).join(', ');
      const label = group.pageName ? `${group.pageName} (${group.page})` : group.page;
      return `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td>${escapeHtml(String(group.failures.length))}</td>
          <td>${escapeHtml(categories)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <section>
      <h2>Failures by page</h2>
      <table>
        <thead><tr><th>Page</th><th>Failures</th><th>Categories</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function renderImage(ref: string | undefined, label: string): string {
  if (ref === undefined) {
    return `<figure><span class="missing">no ${escapeHtml(label)} image</span><figcaption>${escapeHtml(
      label
    )}</figcaption></figure>`;
  }

  return `<figure><img src="${escapeAttribute(ref)}" alt="${escapeAttribute(label)}" /><figcaption>${escapeHtml(
    label
  )}</figcaption></figure>`;
}

function renderTriplet(row: ScenarioReportRow): string {
  return `
    <div class="triplet">
      ${renderImage(row.artifacts?.expected, 'expected')}
      ${renderImage(row.artifacts?.actual, 'actual')}
      ${renderImage(row.artifacts?.diff, 'diff')}
    </div>
  `;
}

function renderList(items: readonly string[]): string {
  if (items.length === 0) {
    return '<p><em>none reported</em></p>';
  }
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderAiAnalysis(row: ScenarioReportRow): string {
  if (row.analysis === undefined) {
    return '';
  }

  const analysis = row.analysis;

  return `
    <div class="ai-analysis">
      <p class="ai-label">${escapeHtml(AI_DISCLAIMER)}</p>
      <p>${escapeHtml(analysis.summary)}</p>
      <p>Severity suggestion: ${escapeHtml(analysis.severitySuggestion)} &middot; Confidence: ${escapeHtml(
    analysis.confidence
  )}</p>
      <h4>Observed evidence</h4>
      ${renderList(analysis.observedEvidence)}
      <h4>Hypotheses</h4>
      ${renderList(analysis.hypotheses)}
      <h4>Recommended investigation steps</h4>
      ${renderList(analysis.recommendedInvestigationSteps)}
    </div>
  `;
}

function renderRow(row: ScenarioReportRow): string {
  return `
    <div class="scenario-row">
      <h3>${escapeHtml(row.page)}${row.pageName ? ` — ${escapeHtml(row.pageName)}` : ''}</h3>
      <p class="dims">
        <code>${escapeHtml(row.scenarioId)}</code>
        &middot; device: ${escapeHtml(row.device)}
        &middot; consent: ${escapeHtml(row.consent)}
        &middot; country: ${escapeHtml(row.country)}
        &middot; ads: ${escapeHtml(String(row.adsEnabled))}
      </p>
      <p class="status-${escapeAttribute(row.status)}">Status: ${escapeHtml(row.status)}</p>
      ${
        row.category !== undefined || row.message !== undefined
          ? `<p>${row.category !== undefined ? `Category: ${escapeHtml(row.category)}` : ''}${
              row.message !== undefined ? ` — ${escapeHtml(row.message)}` : ''
            }</p>`
          : ''
      }
      ${renderTriplet(row)}
      ${renderAiAnalysis(row)}
    </div>
  `;
}

function renderRows(model: ReportModel): string {
  if (model.rows.length === 0) {
    return '<p><em>No scenarios were run.</em></p>';
  }

  return model.rows.map((row) => renderRow(row)).join('');
}

export function renderHtmlReport(model: ReportModel): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Visual QA report — ${escapeHtml(model.runId)}</title>
<style>${STYLE}</style>
</head>
<body>
${renderHeader(model)}
${renderGroups(model)}
<section>
<h2>Scenarios</h2>
${renderRows(model)}
</section>
</body>
</html>
`;
}
