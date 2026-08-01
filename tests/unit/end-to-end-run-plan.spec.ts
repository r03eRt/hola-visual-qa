import { test, expect } from '@playwright/test';
import type { ProjectConfig } from '../../src/config/schema.js';
import type { Scenario } from '../../src/domain/index.js';
import { readinessPolicyFromConfig } from '../../src/stability/index.js';
import { baselineName, type VisualTarget } from '../../src/visual/index.js';
import { buildVisualRunPlan } from '../../src/orchestrator/run-plan.js';

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
    visual: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
    diagnostics: { captureConsole: true, captureNetwork: true, ignoredDomains: [] },
    artifacts: { outputDir: 'reports', retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none' },
    execution: { retries: 0 },
    ...overrides
  } as ProjectConfig;
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'home-desktop-accepted-es-ads_on',
    page: { path: '/' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true,
    ...overrides
  };
}

test.describe('buildVisualRunPlan', () => {
  test('preserves input scenario order', () => {
    const scenarios = [
      scenario({ id: 'a', device: 'desktop' }),
      scenario({ id: 'b', device: 'mobile' }),
      scenario({ id: 'c', device: 'desktop' })
    ];
    const { workItems } = buildVisualRunPlan({ config: baseConfig(), scenarios });
    expect(workItems.map((w) => w.scenario.id)).toEqual(['a', 'b', 'c']);
  });

  test('joins baseUrl and path with exactly one slash', () => {
    const { workItems } = buildVisualRunPlan({
      config: baseConfig({ baseUrl: 'https://example.com/' }),
      scenarios: [scenario({ page: { path: '/pricing' } })]
    });
    expect(workItems[0].url).toBe('https://example.com/pricing');
  });

  test('adds a slash when the path lacks a leading slash', () => {
    const { workItems } = buildVisualRunPlan({
      config: baseConfig({ baseUrl: 'https://example.com' }),
      scenarios: [scenario({ page: { path: 'pricing' } })]
    });
    expect(workItems[0].url).toBe('https://example.com/pricing');
  });

  test('preserves query and hash present on the path', () => {
    const { workItems } = buildVisualRunPlan({
      config: baseConfig({ baseUrl: 'https://example.com/' }),
      scenarios: [scenario({ page: { path: '/search?q=1#top' } })]
    });
    expect(workItems[0].url).toBe('https://example.com/search?q=1#top');
  });

  test('handles a root path without producing a double slash', () => {
    const { workItems } = buildVisualRunPlan({
      config: baseConfig({ baseUrl: 'https://example.com/' }),
      scenarios: [scenario({ page: { path: '/' } })]
    });
    expect(workItems[0].url).toBe('https://example.com/');
  });

  test('defaults to a single full-page target with a deterministic baseline name', () => {
    const s = scenario({ device: 'mobile' });
    const { workItems } = buildVisualRunPlan({ config: baseConfig(), scenarios: [s] });
    expect(workItems[0].targets).toHaveLength(1);
    expect(workItems[0].targets[0].target).toEqual({ kind: 'full-page' });
    expect(workItems[0].targets[0].baselineName).toBe(
      baselineName({ kind: 'full-page' }, { browser: 'chromium', platform: 'ci', device: 'mobile' })
    );
  });

  test('wires the config-derived readiness policy onto every work item', () => {
    const config = baseConfig({ visual: { maxDiffPixelRatio: 0.02, animations: 'allow' } });
    const { workItems } = buildVisualRunPlan({ config, scenarios: [scenario()] });
    expect(workItems[0].readiness).toEqual(readinessPolicyFromConfig(config));
    expect(workItems[0].readiness.animations).toBe('allow');
  });

  test('uses targetsFor targets when it returns a non-empty list', () => {
    const extra: VisualTarget = { kind: 'viewport' };
    const { workItems } = buildVisualRunPlan({
      config: baseConfig(),
      scenarios: [scenario({ device: 'desktop' })],
      targetsFor: () => [extra]
    });
    expect(workItems[0].targets).toHaveLength(1);
    expect(workItems[0].targets[0].target).toEqual(extra);
    expect(workItems[0].targets[0].baselineName).toBe(
      baselineName(extra, { browser: 'chromium', platform: 'ci', device: 'desktop' })
    );
  });

  test('falls back to full-page when targetsFor returns an empty list', () => {
    const { workItems } = buildVisualRunPlan({
      config: baseConfig(),
      scenarios: [scenario()],
      targetsFor: () => []
    });
    expect(workItems[0].targets[0].target).toEqual({ kind: 'full-page' });
  });

  test('does not mutate the input scenarios array', () => {
    const scenarios = [scenario({ id: 'a' }), scenario({ id: 'b' })];
    const snapshot = scenarios.map((s) => s.id);
    buildVisualRunPlan({ config: baseConfig(), scenarios });
    expect(scenarios.map((s) => s.id)).toEqual(snapshot);
  });
});
