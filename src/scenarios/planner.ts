import type { ProjectConfig } from '../config/schema.js';
import { normalizeError, type NormalizedError } from '../domain/error.js';
import type { Scenario } from '../domain/index.js';
import { buildScenarioId } from './id.js';
import { matchesFilter, type ScenarioFilter } from './filter.js';

/** Safety guard on the number of scenarios a single run may produce. */
export const DEFAULT_MAX_SCENARIOS = 500;

export interface PlanOptions {
  filter?: ScenarioFilter;
  maxScenarios?: number;
}

export interface ScenarioPlan {
  scenarios: Scenario[];
  /** Cartesian expansion size before any filtering was applied. */
  totalBeforeFilter: number;
  /** Number of scenarios removed by the include/exclude filter. */
  excludedCount: number;
}

/**
 * Thrown when the requested plan cannot be produced safely: empty after
 * filtering, duplicate scenario IDs, or the count exceeds `maxScenarios`.
 * Always carries a normalized `configuration_error` / `planning` error so
 * callers (e.g. the dry-run CLI) can print a report-safe message and exit
 * non-zero without ever launching a browser.
 */
export class ScenarioPlanningError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string, options?: { evidenceRefs?: string[] }) {
    super(message);
    this.name = 'ScenarioPlanningError';
    this.normalized = normalizeError(message, {
      category: 'configuration_error',
      phase: 'planning',
      evidenceRefs: options?.evidenceRefs
    });
  }
}

/** Builds the unfiltered cartesian expansion of pages x device x consent x country x ads. */
function expandScenarios(config: ProjectConfig): Scenario[] {
  const scenarios: Scenario[] = [];

  for (const page of config.pages) {
    for (const device of config.dimensions.device) {
      for (const consent of config.dimensions.consent) {
        for (const country of config.dimensions.country) {
          for (const adsEnabled of config.dimensions.ads) {
            const pageRef = page.name !== undefined ? { path: page.path, name: page.name } : { path: page.path };
            const id = buildScenarioId({ page: pageRef, device, consent, country, adsEnabled });
            scenarios.push({ id, page: pageRef, device, consent, country, adsEnabled });
          }
        }
      }
    }
  }

  return scenarios;
}

function assertNoDuplicateIds(scenarios: Scenario[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) {
      duplicates.add(scenario.id);
    }
    seen.add(scenario.id);
  }

  if (duplicates.size > 0) {
    throw new ScenarioPlanningError(
      `Duplicate scenario IDs detected: ${Array.from(duplicates).join(', ')}. ` +
        'Check for duplicate pages/dimension values in the project configuration.'
    );
  }
}

/**
 * Deterministically expands `config` into a `ScenarioPlan`, applies the
 * optional include/exclude `filter`, and validates the result BEFORE
 * returning it — no browser is launched by this function. Scenarios are
 * always sorted by `id` for stable ordering, independent of the order of
 * `config.pages` / `config.dimensions` arrays.
 */
export function planScenarios(config: ProjectConfig, options: PlanOptions = {}): ScenarioPlan {
  const maxScenarios = options.maxScenarios ?? DEFAULT_MAX_SCENARIOS;

  const allScenarios = expandScenarios(config);
  assertNoDuplicateIds(allScenarios);

  const totalBeforeFilter = allScenarios.length;
  const filtered = allScenarios.filter((scenario) => matchesFilter(scenario, options.filter));
  const excludedCount = totalBeforeFilter - filtered.length;

  if (filtered.length === 0) {
    throw new ScenarioPlanningError(
      'Scenario plan is empty after filtering: no scenarios would run. Loosen the filter or check the project configuration.'
    );
  }

  if (filtered.length > maxScenarios) {
    throw new ScenarioPlanningError(
      `Scenario plan has ${filtered.length} scenarios, exceeding the maximum of ${maxScenarios}. ` +
        'Narrow the filter or raise maxScenarios explicitly.'
    );
  }

  const scenarios = [...filtered].sort((a, b) => a.id.localeCompare(b.id));

  return { scenarios, totalBeforeFilter, excludedCount };
}
