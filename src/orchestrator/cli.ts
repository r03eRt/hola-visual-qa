import { runVisualSuite } from './orchestrator.js';
import { scenarios } from '../scenarios/scenarios.js';

const updateSnapshots = process.argv.includes('--update');
const result = await runVisualSuite({ scenarios, updateSnapshots });
process.exitCode = result.exitCode;
