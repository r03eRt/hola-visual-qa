import { test, expect } from '@playwright/test';
import { parsePlaywrightReport } from '../../src/orchestrator/playwright-report.js';

/**
 * Hermetic: operates purely on an object-literal Playwright-JSON fixture, no
 * fs/spawn. See docs/features/execution-run-contract/SPEC.md.
 */

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'passed',
    duration: 1200,
    startTime: '2026-01-01T10:00:00.000Z',
    errors: [],
    ...overrides
  };
}

test.describe('parsePlaywrightReport', () => {
  test('maps status/duration/timestamps/errors for a single passing scenario', () => {
    const report = {
      suites: [
        {
          specs: [
            {
              title: 'home-desktop-accepted-ES-ads',
              tests: [
                {
                  results: [makeResult()]
                }
              ]
            }
          ]
        }
      ]
    };

    const outcomes = parsePlaywrightReport(report);

    expect(outcomes).toEqual([
      {
        scenarioId: 'home-desktop-accepted-ES-ads',
        status: 'passed',
        startedAt: '2026-01-01T10:00:00.000Z',
        finishedAt: '2026-01-01T10:00:01.200Z',
        durationMs: 1200,
        errorMessages: []
      }
    ]);
  });

  test('maps timedOut and interrupted to failed', () => {
    const report = {
      suites: [
        {
          specs: [
            { title: 'a', tests: [{ results: [makeResult({ status: 'timedOut' })] }] },
            { title: 'b', tests: [{ results: [makeResult({ status: 'interrupted' })] }] },
            { title: 'c', tests: [{ results: [makeResult({ status: 'failed' })] }] },
            { title: 'd', tests: [{ results: [makeResult({ status: 'skipped' })] }] }
          ]
        }
      ]
    };

    const outcomes = parsePlaywrightReport(report);
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'failed', 'failed', 'skipped']);
  });

  test('collects error messages from result.errors[].message', () => {
    const report = {
      suites: [
        {
          specs: [
            {
              title: 'home-mobile-rejected-ES-noads',
              tests: [
                {
                  results: [
                    makeResult({
                      status: 'failed',
                      errors: [{ message: 'Screenshot comparison failed' }, { message: 'Timeout 30000ms exceeded' }]
                    })
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const [outcome] = parsePlaywrightReport(report);
    expect(outcome?.errorMessages).toEqual(['Screenshot comparison failed', 'Timeout 30000ms exceeded']);
  });

  test('collapses a scenario across a desktop+mobile project pair: skipped-in-one, real-in-other wins', () => {
    // The visual suite `test.skip`s a scenario in the non-matching device
    // project, so the same spec title appears once per project with one
    // skipped result and one real (passed/failed) result.
    const report = {
      suites: [
        {
          title: 'desktop-chromium',
          specs: [
            {
              title: 'home-mobile-accepted-ES-ads',
              tests: [{ results: [makeResult({ status: 'skipped', duration: 0, errors: [] })] }]
            }
          ]
        },
        {
          title: 'mobile-chromium',
          specs: [
            {
              title: 'home-mobile-accepted-ES-ads',
              tests: [{ results: [makeResult({ status: 'passed' })] }]
            }
          ]
        }
      ]
    };

    const outcomes = parsePlaywrightReport(report);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe('passed');
  });

  test('a scenario that failed in any project/test is reported as failed overall', () => {
    const report = {
      suites: [
        {
          specs: [
            {
              title: 'home-desktop-accepted-ES-ads',
              tests: [
                { results: [makeResult({ status: 'passed' })] },
                { results: [makeResult({ status: 'failed', errors: [{ message: 'diff too large' }] })] }
              ]
            }
          ]
        }
      ]
    };

    const [outcome] = parsePlaywrightReport(report);
    expect(outcome?.status).toBe('failed');
    expect(outcome?.errorMessages).toEqual(['diff too large']);
  });

  test('tolerates missing/extra fields without throwing', () => {
    const report = {
      suites: [
        {
          suites: [
            {
              specs: [
                { title: 'nested-scenario', tests: [{ results: [{ status: 'passed' }] }] },
                { title: '', tests: [{ results: [makeResult()] }] },
                { tests: [{ results: [makeResult()] }] },
                { title: 'no-tests' },
                { title: 'no-results', tests: [{}] },
                { title: 'bogus-result', tests: [{ results: [null, 42, 'nope', { status: 'unknown' }] }] }
              ]
            }
          ]
        }
      ],
      extraTopLevelField: { some: 'thing' }
    };

    expect(() => parsePlaywrightReport(report)).not.toThrow();
    const outcomes = parsePlaywrightReport(report);
    const ids = outcomes.map((o) => o.scenarioId);
    expect(ids).toContain('nested-scenario');
    expect(ids).not.toContain('');
    // "bogus-result" produced no valid candidate results, so it is absent.
    expect(ids).not.toContain('bogus-result');
  });

  test('handles a completely empty/garbage report without throwing', () => {
    expect(parsePlaywrightReport(undefined)).toEqual([]);
    expect(parsePlaywrightReport(null)).toEqual([]);
    expect(parsePlaywrightReport({})).toEqual([]);
    expect(parsePlaywrightReport('not an object')).toEqual([]);
  });

  test('deterministic order is first-seen scenarioId', () => {
    const report = {
      suites: [
        {
          specs: [
            { title: 'c', tests: [{ results: [makeResult()] }] },
            { title: 'a', tests: [{ results: [makeResult()] }] },
            { title: 'b', tests: [{ results: [makeResult()] }] },
            { title: 'a', tests: [{ results: [makeResult({ status: 'failed' })] }] }
          ]
        }
      ]
    };

    const outcomes = parsePlaywrightReport(report);
    expect(outcomes.map((o) => o.scenarioId)).toEqual(['c', 'a', 'b']);
  });
});
