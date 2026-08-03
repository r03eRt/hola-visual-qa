import { test, expect } from '@playwright/test';
import type { ProjectConfig } from '../../src/config/schema.js';
import { buildScenarioId, slugify } from '../../src/scenarios/id.js';
import { matchesFilter, type ScenarioFilter } from '../../src/scenarios/filter.js';
import {
  planScenarios,
  DEFAULT_MAX_SCENARIOS,
  ScenarioPlanningError
} from '../../src/scenarios/planner.js';
import type { Scenario } from '../../src/domain/index.js';

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    schemaVersion: 1,
    projectName: 'hola-visual-qa',
    baseUrl: 'https://example.com',
    allowedHosts: ['example.com'],
    pages: [{ path: '/' }],
    dimensions: {
      device: ['desktop', 'mobile'],
      consent: ['accepted', 'rejected'],
      country: ['ES'],
      ads: [true, false]
    },
    adapters: { consent: {}, ads: {}, country: {} },
    visual: { maxDiffPixelRatio: 0.01, animations: 'disabled', maskSelectors: ['[data-visual-mask]'] },
    diagnostics: { captureConsole: true, captureNetwork: true, ignoredDomains: [] },
    artifacts: { outputDir: 'reports', retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none' },
    execution: { retries: 0 },
    ...overrides
  } as ProjectConfig;
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'x',
    page: { path: '/' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true,
    ...overrides
  };
}

test.describe('slugify / buildScenarioId', () => {
  test('slugifies lowercase, non-alphanumeric collapsing and trims', () => {
    expect(slugify('Home Page!!')).toBe('home-page');
    expect(slugify('  --Weird__Name--  ')).toBe('weird-name');
  });

  test('falls back to "root" for inputs that slugify to empty', () => {
    expect(slugify('/')).toBe('root');
    expect(slugify('///')).toBe('root');
  });

  test('builds the documented ID format, preferring name over path', () => {
    const id = buildScenarioId({
      page: { path: '/', name: 'Home' },
      device: 'desktop',
      consent: 'accepted',
      country: 'ES',
      adsEnabled: true
    });
    expect(id).toBe('home-desktop-accepted-es-ads_on');
  });

  test('uses the slugified path when no name is present, and ads_off for disabled ads', () => {
    const id = buildScenarioId({
      page: { path: '/about-us' },
      device: 'mobile',
      consent: 'rejected',
      country: 'FR',
      adsEnabled: false
    });
    expect(id).toBe('about-us-mobile-rejected-fr-ads_off');
  });
});

test.describe('matchesFilter', () => {
  test('returns true when no filter is provided', () => {
    expect(matchesFilter(scenario(), undefined)).toBe(true);
  });

  test('include filters narrow by page path or name', () => {
    const withName = scenario({ page: { path: '/x', name: 'home' } });
    expect(matchesFilter(withName, { pages: ['home'] })).toBe(true);
    expect(matchesFilter(withName, { pages: ['/x'] })).toBe(true);
    expect(matchesFilter(withName, { pages: ['/other'] })).toBe(false);
  });

  test('include filters narrow by device, consent, country and ads', () => {
    const s = scenario({ device: 'mobile', consent: 'rejected', country: 'FR', adsEnabled: false });
    expect(matchesFilter(s, { devices: ['mobile'] })).toBe(true);
    expect(matchesFilter(s, { devices: ['desktop'] })).toBe(false);
    expect(matchesFilter(s, { consent: ['rejected'] })).toBe(true);
    expect(matchesFilter(s, { consent: ['accepted'] })).toBe(false);
    expect(matchesFilter(s, { countries: ['fr'] })).toBe(true); // case-insensitive
    expect(matchesFilter(s, { countries: ['ES'] })).toBe(false);
    expect(matchesFilter(s, { ads: [false] })).toBe(true);
    expect(matchesFilter(s, { ads: [true] })).toBe(false);
  });

  test('include filters narrow by tags', () => {
    const s = scenario({ tags: ['smoke', 'checkout'] });
    expect(matchesFilter(s, { tags: ['checkout'] })).toBe(true);
    expect(matchesFilter(s, { tags: ['nope'] })).toBe(false);
  });

  test('excludeCombinations removes matches even when include filters would allow them', () => {
    const s = scenario({ device: 'mobile', country: 'FR' });
    const filter: ScenarioFilter = {
      devices: ['mobile'],
      excludeCombinations: [{ device: 'mobile', country: 'fr' }]
    };
    expect(matchesFilter(s, filter)).toBe(false);
  });

  test('excludeCombinations only removes when every populated field matches (partial match keeps it)', () => {
    const s = scenario({ device: 'mobile', country: 'FR' });
    const filter: ScenarioFilter = {
      excludeCombinations: [{ device: 'desktop', country: 'fr' }]
    };
    expect(matchesFilter(s, filter)).toBe(true);
  });
});

test.describe('planScenarios', () => {
  test('expands pages x device x consent x country x ads with the correct count and shape', () => {
    const config = baseConfig();
    const plan = planScenarios(config);
    expect(plan.totalBeforeFilter).toBe(1 * 2 * 2 * 1 * 2);
    expect(plan.scenarios.length).toBe(8);
    expect(plan.excludedCount).toBe(0);
    for (const s of plan.scenarios) {
      expect(s.page).toEqual({ path: '/' });
      expect(['desktop', 'mobile']).toContain(s.device);
      expect(['accepted', 'rejected']).toContain(s.consent);
      expect(s.country).toBe('ES');
      expect(typeof s.adsEnabled).toBe('boolean');
      expect(typeof s.id).toBe('string');
    }
  });

  test('produces the same ordered scenario IDs regardless of dimension array order', () => {
    const config1 = baseConfig({
      dimensions: {
        device: ['desktop', 'mobile'],
        consent: ['accepted', 'rejected'],
        country: ['ES', 'FR'],
        ads: [true, false]
      }
    });
    const config2 = baseConfig({
      dimensions: {
        device: ['mobile', 'desktop'],
        consent: ['rejected', 'accepted'],
        country: ['FR', 'ES'],
        ads: [false, true]
      }
    });

    const plan1 = planScenarios(config1);
    const plan2 = planScenarios(config2);

    expect(plan1.scenarios.map((s) => s.id)).toEqual(plan2.scenarios.map((s) => s.id));
    // Sanity: the list is actually sorted.
    const ids = plan1.scenarios.map((s) => s.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  test('include filter narrows the plan', () => {
    const config = baseConfig();
    const plan = planScenarios(config, { filter: { devices: ['desktop'] } });
    expect(plan.scenarios.every((s) => s.device === 'desktop')).toBe(true);
    expect(plan.scenarios.length).toBe(4);
    expect(plan.excludedCount).toBe(4);
    expect(plan.totalBeforeFilter).toBe(8);
  });

  test('exclude filter / excludeCombinations removes matches from the plan', () => {
    const config = baseConfig();
    const plan = planScenarios(config, {
      filter: { excludeCombinations: [{ consent: 'rejected' }] }
    });
    expect(plan.scenarios.every((s) => s.consent === 'accepted')).toBe(true);
    expect(plan.scenarios.length).toBe(4);
  });

  test('throws a normalized configuration_error/planning error when the plan is empty after filtering', () => {
    const config = baseConfig();
    let thrown: unknown;
    try {
      planScenarios(config, { filter: { countries: ['DOES_NOT_EXIST'] } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScenarioPlanningError);
    const error = thrown as ScenarioPlanningError;
    expect(error.normalized.category).toBe('configuration_error');
    expect(error.normalized.phase).toBe('planning');
  });

  test('throws a normalized configuration_error/planning error when maxScenarios is exceeded', () => {
    const config = baseConfig();
    let thrown: unknown;
    try {
      planScenarios(config, { maxScenarios: 3 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScenarioPlanningError);
    const error = thrown as ScenarioPlanningError;
    expect(error.normalized.category).toBe('configuration_error');
    expect(error.normalized.phase).toBe('planning');
  });

  test('respects the DEFAULT_MAX_SCENARIOS export as the default guard', () => {
    expect(DEFAULT_MAX_SCENARIOS).toBeGreaterThan(0);
    const config = baseConfig();
    // Well within default max, should not throw.
    expect(() => planScenarios(config)).not.toThrow();
  });

  test('detects and rejects duplicate scenario IDs (collision)', () => {
    const config = baseConfig({
      dimensions: {
        device: ['desktop'],
        consent: ['accepted'],
        // Duplicate country values (differing only by case) collide once slugified.
        country: ['ES', 'es'],
        ads: [true]
      }
    });
    let thrown: unknown;
    try {
      planScenarios(config);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScenarioPlanningError);
    const error = thrown as ScenarioPlanningError;
    expect(error.normalized.category).toBe('configuration_error');
    expect(error.normalized.phase).toBe('planning');
  });
});
