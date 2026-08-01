import { loadConfig } from '../config/load-config.js';
import { planScenarios } from '../scenarios/index.js';
import { buildVisualRunPlan } from './run-plan.js';
import { runVisualSuite } from './orchestrator.js';

const updateSnapshots = process.argv.includes('--update');

const config = loadConfig();
const { scenarios } = planScenarios(config);

// Build the run plan up front so an invalid config/plan fails before any
// browser process is spawned. The plan is deterministic and touches no
// browser; the Playwright suite re-derives it from the same inputs.
buildVisualRunPlan({ config, scenarios });

const result = await runVisualSuite({ scenarios, updateSnapshots });
process.exitCode = result.exitCode;
