import { test, expect } from '@playwright/test';
import {
  render404Page,
  renderRunListPage,
  renderRunReportPage
} from '../../src/dashboard/report-page.js';
import { buildReportModel } from '../../src/reporting/html/report-model.js';
import type { RunManifest, RunResult, RunSummary, ScenarioResult } from '../../src/domain/index.js';

/**
 * Pure unit tests for the report-viewer renderer (#32 /
 * docs/features/local-dashboard-report-viewer/SPEC.md). No fs/net; asserts
 * on rendered HTML strings only, including that every dynamic value is
 * escaped and that no `<img>`/`<script>`/CDN reference is ever emitted.
 */

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: '20260101T000000Z-aaaa',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
    deterministicFailure: false,
    ...overrides
  };
}

function manifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    toolVersion: '0.0.0',
    os: 'darwin arm64',
    browser: { name: 'chromium', version: '120.0' },
    configHash: 'a'.repeat(8),
    scenarioIds: ['scenario-a'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function scenarioResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenario: {
      id: 'scenario-a',
      page: { path: '/' },
      device: 'desktop',
      consent: 'accepted',
      country: 'ES',
      adsEnabled: true
    },
    status: 'passed',
    errors: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    ...overrides
  };
}

function runResult(overrides: Partial<RunResult> = {}): RunResult {
  const runId = '20260101T000000Z-aaaa';
  return {
    runId,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    manifest: manifest(),
    results: [scenarioResult()],
    counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
    deterministicFailure: false,
    ...overrides
  };
}

test.describe('renderRunListPage', () => {
  test('renders a table row per run with a link to /runs/:id and a badge', () => {
    const html = renderRunListPage([summary()]);
    expect(html).toContain('href="/runs/20260101T000000Z-aaaa"');
    expect(html).toContain('20260101T000000Z-aaaa');
    expect(html).toContain('badge-pass');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/https?:\/\/(?!localhost)/);
  });

  test('renders an empty state with no runs', () => {
    const html = renderRunListPage([]);
    expect(html).toContain('No runs found');
  });

  test('escapes a malicious run-id in both the link and the label', () => {
    const maliciousId = '"><script>alert(1)</script>';
    const html = renderRunListPage([summary({ runId: maliciousId })]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('shows a fail badge when deterministicFailure is true', () => {
    const html = renderRunListPage([summary({ deterministicFailure: true })]);
    expect(html).toContain('badge-fail');
  });
});

test.describe('renderRunReportPage', () => {
  test('renders the summary header and per-scenario verdicts, with no images', () => {
    const model = buildReportModel(runResult());
    const html = renderRunReportPage(model);

    expect(html).toContain('20260101T000000Z-aaaa');
    expect(html).toContain('scenario-a');
    expect(html).toContain('desktop');
    expect(html).toContain('accepted');
    expect(html).toContain('ES');
    expect(html).toContain('passed');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });

  test('renders probable error category/message when a scenario failed', () => {
    const failing = runResult({
      results: [
        scenarioResult({
          status: 'failed',
          errors: [
            {
              code: 'diff-threshold-exceeded',
              category: 'visual_regression',
              severity: 'error',
              message: 'diff exceeds threshold',
              phase: 'assertion',
              timestamp: '2026-01-01T00:00:00.500Z'
            }
          ]
        })
      ],
      counts: { passed: 0, failed: 1, skipped: 0, total: 1 },
      deterministicFailure: true
    });
    const model = buildReportModel(failing);
    const html = renderRunReportPage(model);

    expect(html).toContain('visual_regression');
    expect(html).toContain('diff exceeds threshold');
    expect(html).toContain('badge-fail');
  });

  test('escapes a malicious scenario id/message', () => {
    const malicious = runResult({
      results: [
        scenarioResult({
          scenario: {
            id: '<script>alert(1)</script>',
            page: { path: '/' },
            device: 'desktop',
            consent: 'accepted',
            country: 'ES',
            adsEnabled: true
          },
          status: 'failed',
          errors: [
            {
              code: 'other-error',
              category: 'internal_error',
              severity: 'error',
              message: '"><script>bad()</script>',
              phase: 'assertion',
              timestamp: '2026-01-01T00:00:00.500Z'
            }
          ]
        })
      ],
      counts: { passed: 0, failed: 1, skipped: 0, total: 1 },
      deterministicFailure: true
    });
    const model = buildReportModel(malicious);
    const html = renderRunReportPage(model);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

test.describe('render404Page', () => {
  test('renders an escaped, minimal 404 message', () => {
    const html = render404Page('This run was not found.');
    expect(html).toContain('This run was not found.');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
  });

  test('escapes a malicious message', () => {
    const html = render404Page('<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
