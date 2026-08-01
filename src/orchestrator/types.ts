import type { Scenario } from '../domain/index.js';

export interface RunRequest {
  scenarios: readonly Scenario[];
  updateSnapshots?: boolean;
}
export interface RunResult {
  command: string;
  scenarioIds: string[];
  exitCode: number;
}
