import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * IMPURE. The ONLY spawn/fs layer in `src/orchestrator`: runs
 * `npx playwright <args>`, capturing the JSON reporter output to a temp
 * file, then parses and returns it. Kept tiny and isolated so `run.ts` stays
 * unit-testable via an injected `runSuite` fake. Left uncovered by design
 * (see docs/features/execution-run-contract/SPEC.md test plan).
 */
export async function runPlaywrightSuite(
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<unknown> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hola-playwright-report-'));
  const reportPath = path.join(tempDir, 'report.json');

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('npx', ['playwright', ...args], {
        stdio: 'inherit',
        env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath }
      });
      child.on('error', reject);
      child.on('close', () => resolve());
    });

    const raw = await readFile(reportPath, 'utf8');
    return JSON.parse(raw) as unknown;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
