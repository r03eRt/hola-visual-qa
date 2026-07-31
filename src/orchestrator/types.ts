import type { VisualScenario } from '../scenarios/scenarios.js';

export interface RunRequest { scenarios: VisualScenario[]; updateSnapshots?: boolean; }
export interface RunResult { command: string; scenarioIds: string[]; exitCode: number; }
