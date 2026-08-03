import { test, expect } from '@playwright/test';
import { normalizeError, type ScenarioResult, type RunManifest, type Scenario, type RunResult } from '../../src/domain/index.js';
import { buildRunResult, type BuildRunResultInput } from '../../src/reporting/aggregate.js';
import { buildReportModel } from '../../src/reporting/html/report-model.js';
import { renderHtmlReport } from '../../src/reporting/html/render.js';
import type { AiAnalysis } from '../../src/ai/analysis.js';
import type { RedactionNotes } from '../../src/evidence/contract.js';

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'home-desktop-accepted-es',
    page: { path: '/' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true,
    ...overrides
  };
}

function scenarioResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenario: scenario(),
    status: 'passed',
    errors: [],
    startedAt: '2026-07-31T10:00:00.000Z',
    finishedAt: '2026-07-31T10:00:01.000Z',
    durationMs: 1000,
    ...overrides
  };
}

function manifest(): RunManifest {
  return {
    toolVersion: '0.0.0',
    os: 'darwin arm64',
    browser: { name: 'chromium', version: '120.0' },
    configHash: 'a'.repeat(64),
    scenarioIds: ['home-desktop-accepted-es'],
    createdAt: '2026-07-31T09:59:00.000Z'
  };
}

function redactionNotes(overrides: Partial<RedactionNotes> = {}): RedactionNotes {
  return {
    secretsRedacted: 0,
    urlParamsRedacted: 0,
    truncatedFields: 0,
    droppedConsole: 0,
    droppedNetwork: 0,
    droppedErrors: 0,
    ...overrides
  };
}

function analysis(overrides: Partial<AiAnalysis> = {}): AiAnalysis {
  return {
    summary: 'The visual diff appears in the header region.',
    severitySuggestion: 'medium',
    observedEvidence: ['1 failed check: visual_regression'],
    hypotheses: ['A recent CSS change may have shifted the header layout'],
    recommendedInvestigationSteps: ['Compare the diff image against the last approved baseline'],
    confidence: 'medium',
    redactionNotes: redactionNotes(),
    ...overrides
  };
}

function runFrom(results: ScenarioResult[], input: Partial<BuildRunResultInput> = {}): RunResult {
  return buildRunResult({
    runId: '20260731T100000Z-abc123',
    startedAt: '2026-07-31T10:00:00.000Z',
    finishedAt: '2026-07-31T10:05:00.000Z',
    manifest: manifest(),
    results,
    ...input
  });
}

test.describe('renderHtmlReport', () => {
  test('emits a self-contained document with no external resources or scripts', () => {
    const run = runFrom([scenarioResult({ status: 'passed' })]);
    const html = renderHtmlReport(buildReportModel(run));

    expect(html.startsWith('<!doctype html')).toBe(true);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).not.toContain('src="//');
  });

  test('renders the visual triplet images when artifacts are present', () => {
    const run = runFrom([
      scenarioResult({
        status: 'failed',
        artifacts: {
          expected: 'artifacts/home/expected.png',
          actual: 'artifacts/home/actual.png',
          diff: 'artifacts/home/diff.png'
        }
      })
    ]);
    const html = renderHtmlReport(buildReportModel(run));

    expect(html).toContain('src="artifacts/home/expected.png"');
    expect(html).toContain('src="artifacts/home/actual.png"');
    expect(html).toContain('src="artifacts/home/diff.png"');
  });

  test('renders a "no image" note when artifact refs are absent', () => {
    const run = runFrom([scenarioResult({ status: 'passed' })]);
    const html = renderHtmlReport(buildReportModel(run));

    expect(html).toContain('no expected image');
    expect(html).toContain('no actual image');
    expect(html).toContain('no diff image');
  });

  test('omits the failures-by-page section for a clean passing run', () => {
    const run = runFrom([scenarioResult({ status: 'passed' })]);
    const html = renderHtmlReport(buildReportModel(run));

    expect(html).not.toContain('Failures by page');
  });

  test('renders the AI analysis block with the exact disclaimer label when supplied', () => {
    const run = runFrom([scenarioResult({ scenario: scenario({ id: 'a' }), status: 'passed' })]);
    const analyses = new Map([['a', analysis()]]);
    const html = renderHtmlReport(buildReportModel(run, { analyses }));

    expect(html).toContain('<div class="ai-analysis">');
    expect(html).toContain('AI analysis — informational only, not a pass/fail decision');
    expect(html).toContain('The visual diff appears in the header region.');
  });

  test('omits the AI analysis block entirely when no analysis is supplied', () => {
    const run = runFrom([scenarioResult({ status: 'passed' })]);
    const html = renderHtmlReport(buildReportModel(run));

    expect(html).not.toContain('<div class="ai-analysis">');
    expect(html).not.toContain('AI analysis — informational only, not a pass/fail decision');
  });

  test('escapes a script-injection attempt in an error message', () => {
    const maliciousError = normalizeError(new Error(`console said: <script>alert(1)</script> and "quoted" 'text'`), {
      category: 'console_error',
      phase: 'diagnostics'
    });
    const run = runFrom([scenarioResult({ status: 'failed', errors: [maliciousError] })]);
    const html = renderHtmlReport(buildReportModel(run));

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapes a script-injection attempt in an AI analysis summary', () => {
    const run = runFrom([scenarioResult({ scenario: scenario({ id: 'a' }), status: 'passed' })]);
    const analyses = new Map([['a', analysis({ summary: `<script>alert(1)</script> "quoted" 'text'` })]]);
    const html = renderHtmlReport(buildReportModel(run, { analyses }));

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapes a script-injection attempt in an artifact ref path', () => {
    const run = runFrom([
      scenarioResult({
        status: 'failed',
        artifacts: { expected: 'artifacts/"><script>alert(1)</script>.png' }
      })
    ]);
    const html = renderHtmlReport(buildReportModel(run));

    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
