import { loadConfig, ConfigValidationError } from '../config/load-config.js';
import type { ScenarioFilter } from './filter.js';
import { planScenarios, ScenarioPlanningError } from './planner.js';

/**
 * Dry-run CLI: loads the project configuration, expands + filters the
 * scenario plan, and prints the ordered scenario IDs and counts. Never
 * launches a browser. Exits non-zero (printing only the normalized,
 * report-safe message — no stack trace) on any validation failure.
 *
 * Flags (all repeatable except --max):
 *   --page <path|name>     narrow to matching pages
 *   --device <desktop|mobile>
 *   --country <code>
 *   --tag <tag>
 *   --max <n>              override the maxScenarios safety guard
 */
interface ParsedArgs {
  filter: ScenarioFilter;
  maxScenarios?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const filter: ScenarioFilter = {};
  let maxScenarios: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];

    switch (arg) {
      case '--page':
        if (value !== undefined) {
          filter.pages = [...(filter.pages ?? []), value];
          i += 1;
        }
        break;
      case '--device':
        if (value === 'desktop' || value === 'mobile') {
          filter.devices = [...(filter.devices ?? []), value];
          i += 1;
        }
        break;
      case '--country':
        if (value !== undefined) {
          filter.countries = [...(filter.countries ?? []), value];
          i += 1;
        }
        break;
      case '--tag':
        if (value !== undefined) {
          filter.tags = [...(filter.tags ?? []), value];
          i += 1;
        }
        break;
      case '--max':
        if (value !== undefined) {
          maxScenarios = Number(value);
          i += 1;
        }
        break;
      default:
        break;
    }
  }

  return { filter, maxScenarios };
}

function hasAnyFilter(filter: ScenarioFilter): boolean {
  return Object.values(filter).some((value) => Array.isArray(value) && value.length > 0);
}

function main(): void {
  const { filter, maxScenarios } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const plan = planScenarios(config, {
    filter: hasAnyFilter(filter) ? filter : undefined,
    maxScenarios
  });

  console.log(
    `Scenario plan: ${plan.scenarios.length} of ${plan.totalBeforeFilter} scenario(s) ` +
      `(${plan.excludedCount} excluded by filter)`
  );
  for (const scenario of plan.scenarios) {
    console.log(scenario.id);
  }
}

try {
  main();
} catch (error) {
  if (error instanceof ScenarioPlanningError) {
    console.error(error.normalized.message);
  } else if (error instanceof ConfigValidationError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}
