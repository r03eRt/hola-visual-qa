import { loadConfig } from '../config/load-config.js';
import { planScenarios } from '../scenarios/index.js';
import { summaryPath } from '../artifacts/paths.js';
import { executeRun } from './run.js';

const updateSnapshots = process.argv.includes('--update');

const config = loadConfig();
const { scenarios } = planScenarios(config);

const result = await executeRun({ config, scenarios, updateSnapshots });

console.log(`Run ${result.runId} complete.`);
console.log(`Summary: ${summaryPath(config.artifacts.outputDir, result.runId)}`);

process.exitCode = result.deterministicFailure ? 1 : 0;
