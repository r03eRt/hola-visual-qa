import { test, expect } from '@playwright/test';
import { normalizeError, type ScenarioResult, type Scenario } from '../../src/domain/index.js';
import {
  groupFailuresByCategory,
  groupFailuresByPageAndCategory,
  summarizeFailures
} from '../../src/reporting/index.js';

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

test.describe('groupFailuresByCategory', () => {
  test('orders categories by descending count, breaking ties by first-appearance', () => {
    const navError = normalizeError(new Error('Nav failed'), { category: 'navigation_error', phase: 'navigation' });
    const consoleError = normalizeError(new Error('Console error'), {
      category: 'console_error',
      phase: 'diagnostics'
    });
    const visualError = normalizeError(new Error('Regression detected'), {
      category: 'visual_regression',
      phase: 'assertion'
    });

    const results = [
      scenarioResult({ scenario: scenario({ id: 'a' }), status: 'failed', errors: [navError] }),
      scenarioResult({ scenario: scenario({ id: 'b' }), status: 'failed', errors: [consoleError] }),
      scenarioResult({ scenario: scenario({ id: 'c' }), status: 'failed', errors: [visualError] }),
      scenarioResult({ scenario: scenario({ id: 'd' }), status: 'failed', errors: [consoleError] })
    ];

    const groups = groupFailuresByCategory(results);

    // console_error and navigation_error are both tied at counts 2 vs 1;
    // navigation_error (seen first) is a single, console_error (seen second)
    // has 2 -> highest count first, then navigation_error before visual_regression (equal count 1, navigation seen first).
    expect(groups.map((g) => g.category)).toEqual(['console_error', 'navigation_error', 'visual_regression']);
    expect(groups[0]!.failures.map((f) => f.scenarioId)).toEqual(['b', 'd']);
  });

  test('equal counts across categories are ordered by first-appearance', () => {
    const errorA = normalizeError(new Error('A failed'), { category: 'navigation_error', phase: 'navigation' });
    const errorB = normalizeError(new Error('B failed'), { category: 'network_failure', phase: 'navigation' });

    const results = [
      scenarioResult({ scenario: scenario({ id: 'x1' }), status: 'failed', errors: [errorB] }),
      scenarioResult({ scenario: scenario({ id: 'x2' }), status: 'failed', errors: [errorA] }),
      scenarioResult({ scenario: scenario({ id: 'x3' }), status: 'failed', errors: [errorB] }),
      scenarioResult({ scenario: scenario({ id: 'x4' }), status: 'failed', errors: [errorA] })
    ];

    const groups = groupFailuresByCategory(results);

    expect(groups.map((g) => ({ category: g.category, count: g.failures.length }))).toEqual([
      { category: 'network_failure', count: 2 },
      { category: 'navigation_error', count: 2 }
    ]);
  });

  test('keeps input order within a bucket and excludes skipped/clean-passed results', () => {
    const warning = normalizeError(new Error('AI note'), { category: 'ai_provider_error', phase: 'ai_analysis' });
    const hard = normalizeError(new Error('Console error observed'), {
      category: 'console_error',
      phase: 'diagnostics'
    });

    const results = [
      scenarioResult({ status: 'skipped' }),
      scenarioResult({ status: 'passed' }),
      scenarioResult({ status: 'passed', errors: [warning] }),
      scenarioResult({ scenario: scenario({ id: 'failed-1' }), status: 'failed', errors: [] }),
      scenarioResult({ scenario: scenario({ id: 'passed-hard' }), status: 'passed', errors: [hard] })
    ];

    const groups = groupFailuresByCategory(results);

    expect(groups.map((g) => g.category)).toEqual(['unknown_error', 'console_error']);
    expect(groups[0]!.failures).toHaveLength(1);
    expect(groups[1]!.failures[0]!.scenarioId).toBe('passed-hard');
  });
});

test.describe('groupFailuresByPageAndCategory', () => {
  test('nests categories under first-seen pages with correct per-page total and category ordering', () => {
    const consoleError = normalizeError(new Error('Console error'), {
      category: 'console_error',
      phase: 'diagnostics'
    });
    const visualError = normalizeError(new Error('Regression detected'), {
      category: 'visual_regression',
      phase: 'assertion'
    });

    const results = [
      scenarioResult({
        scenario: scenario({ id: 'contact-1', page: { path: '/contact' } }),
        status: 'failed',
        errors: [visualError]
      }),
      scenarioResult({
        scenario: scenario({ id: 'home-1', page: { path: '/' } }),
        status: 'failed',
        errors: [consoleError]
      }),
      scenarioResult({
        scenario: scenario({ id: 'contact-2', page: { path: '/contact' } }),
        status: 'failed',
        errors: [consoleError]
      }),
      scenarioResult({
        scenario: scenario({ id: 'contact-3', page: { path: '/contact' } }),
        status: 'failed',
        errors: [consoleError]
      })
    ];

    const groups = groupFailuresByPageAndCategory(results);

    expect(groups.map((g) => g.page)).toEqual(['/contact', '/']);
    expect(groups[0]!.total).toBe(3);
    expect(groups[0]!.categories.map((c) => c.category)).toEqual(['console_error', 'visual_regression']);
    expect(groups[0]!.categories[0]!.failures.map((f) => f.scenarioId)).toEqual(['contact-2', 'contact-3']);
    expect(groups[1]!.total).toBe(1);
    expect(groups[1]!.categories.map((c) => c.category)).toEqual(['console_error']);
  });

  test('populates page and pageName on failure items, pageName only when present', () => {
    const results = [
      scenarioResult({
        scenario: scenario({ id: 'named', page: { path: '/contact', name: 'Contact Us' } }),
        status: 'failed',
        errors: []
      }),
      scenarioResult({
        scenario: scenario({ id: 'unnamed', page: { path: '/' } }),
        status: 'failed',
        errors: []
      })
    ];

    const groups = groupFailuresByPageAndCategory(results);

    expect(groups[0]!.page).toBe('/contact');
    expect(groups[0]!.pageName).toBe('Contact Us');
    expect(groups[0]!.categories[0]!.failures[0]!.page).toBe('/contact');
    expect(groups[0]!.categories[0]!.failures[0]!.pageName).toBe('Contact Us');

    expect(groups[1]!.pageName).toBeUndefined();
    expect(groups[1]!.categories[0]!.failures[0]!.pageName).toBeUndefined();
  });
});

test.describe('summarizeFailures', () => {
  test('total equals failing count and matches the sum of category counts and page counts', () => {
    const consoleError = normalizeError(new Error('Console error'), {
      category: 'console_error',
      phase: 'diagnostics'
    });
    const visualError = normalizeError(new Error('Regression detected'), {
      category: 'visual_regression',
      phase: 'assertion'
    });
    const warning = normalizeError(new Error('AI note'), { category: 'ai_provider_error', phase: 'ai_analysis' });

    const results = [
      scenarioResult({ status: 'skipped' }),
      scenarioResult({ status: 'passed' }),
      scenarioResult({ status: 'passed', errors: [warning] }),
      scenarioResult({
        scenario: scenario({ id: 'contact-1', page: { path: '/contact' } }),
        status: 'failed',
        errors: [visualError]
      }),
      scenarioResult({
        scenario: scenario({ id: 'home-1', page: { path: '/' } }),
        status: 'failed',
        errors: [consoleError]
      }),
      scenarioResult({
        scenario: scenario({ id: 'contact-2', page: { path: '/contact' } }),
        status: 'passed',
        errors: [visualError]
      })
    ];

    const summary = summarizeFailures(results);

    expect(summary.total).toBe(3);
    const categorySum = summary.byCategory.reduce((sum, c) => sum + c.count, 0);
    const pageSum = summary.byPage.reduce((sum, p) => sum + p.count, 0);
    expect(categorySum).toBe(summary.total);
    expect(pageSum).toBe(summary.total);

    expect(summary.byPage.map((p) => p.page)).toEqual(['/contact', '/']);
    expect(summary.byPage[0]!.count).toBe(2);
    expect(summary.byPage[1]!.count).toBe(1);
  });

  test('returns zeros/empty arrays for a clean run', () => {
    const summary = summarizeFailures([scenarioResult({ status: 'passed' }), scenarioResult({ status: 'skipped' })]);

    expect(summary).toEqual({ total: 0, byCategory: [], byPage: [] });
  });
});
