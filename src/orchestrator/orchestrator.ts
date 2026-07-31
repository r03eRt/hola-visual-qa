import { spawn } from 'node:child_process';
import type { RunRequest, RunResult } from './types.js';

export async function runVisualSuite(request: RunRequest): Promise<RunResult> {
  const scenarioIds = request.scenarios.map(s => s.id);
  const args = ['playwright', 'test', 'tests/visual'];
  if (request.updateSnapshots) args.push('--update-snapshots');
  const command = `npx ${args.join(' ')}`;
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn('npx', args, { stdio: 'inherit', env: { ...process.env, VISUAL_SCENARIOS: scenarioIds.join(',') } });
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
  return { command, scenarioIds, exitCode };
}
