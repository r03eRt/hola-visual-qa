import type { ProjectConfig } from '../config/schema.js';
import type { Scenario } from '../domain/index.js';
import { placementsForScenario, type PlacementDefinition } from '../placements/index.js';
import { readinessPolicyFromConfig, type ReadinessPolicy } from '../stability/index.js';
import { baselineName, type VisualTarget } from '../visual/index.js';

export interface TargetWorkItem {
  target: VisualTarget;
  /** `baselineName(target, partition)` from src/visual, see below for the partition used. */
  baselineName: string;
}

export interface ScenarioWorkItem {
  scenario: Scenario;
  /** `config.baseUrl` joined with `scenario.page.path` (no double slash). */
  url: string;
  /** `readinessPolicyFromConfig(config)`. */
  readiness: ReadinessPolicy;
  /** At least the default full-page target. */
  targets: TargetWorkItem[];
  /** Placement definitions applicable to this scenario's page (may be empty). */
  placements: PlacementDefinition[];
}

export interface VisualRunPlan {
  workItems: ScenarioWorkItem[];
}

export interface BuildRunPlanInput {
  config: ProjectConfig;
  /** Caller passes `planScenarios(config).scenarios`. */
  scenarios: readonly Scenario[];
  /** Optional extra targets beyond the default full-page (e.g. viewport). */
  targetsFor?: (scenario: Scenario) => VisualTarget[];
}

const DEFAULT_TARGET: VisualTarget = { kind: 'full-page' };

/**
 * Safely joins `baseUrl` with a page `path`, guaranteeing exactly one `/`
 * between them and preserving any query/hash already present on `path`.
 * Pure string manipulation — never throws on a normal path.
 */
function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${normalizedPath}`;
}

/**
 * Resolves the `VisualTarget`s to capture for `scenario`: `targetsFor`'s
 * result when non-empty, else the default full-page target.
 */
function resolveTargets(scenario: Scenario, targetsFor?: (scenario: Scenario) => VisualTarget[]): VisualTarget[] {
  if (!targetsFor) return [DEFAULT_TARGET];
  const targets = targetsFor(scenario);
  return targets.length > 0 ? targets : [DEFAULT_TARGET];
}

/**
 * Pure, deterministic expansion of `scenarios` into a `VisualRunPlan`. No
 * fs/Date/random/env; no browser is touched. Preserves the input scenario
 * order. The baseline partition used here (`{ browser: 'chromium', platform:
 * 'ci', device: scenario.device, scenarioId: scenario.id }`) is a stable
 * logical partition — the scenario id keeps consent/ads/country variants on
 * their own baseline, and the real per-project browser/platform partition is
 * applied by the Playwright project at snapshot time via `snapshotPathTemplate`.
 */
export function buildVisualRunPlan(input: BuildRunPlanInput): VisualRunPlan {
  const { config, scenarios, targetsFor } = input;
  const readiness = readinessPolicyFromConfig(config);

  const workItems: ScenarioWorkItem[] = scenarios.map((scenario) => {
    const targets = resolveTargets(scenario, targetsFor);
    const targetItems: TargetWorkItem[] = targets.map((target) => ({
      target,
      baselineName: baselineName(target, {
        browser: 'chromium',
        platform: 'ci',
        device: scenario.device,
        scenarioId: scenario.id
      })
    }));

    return {
      scenario,
      url: joinUrl(config.baseUrl, scenario.page.path),
      readiness,
      targets: targetItems,
      placements: placementsForScenario(config.placements ?? [], scenario)
    };
  });

  return { workItems };
}
