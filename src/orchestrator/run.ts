import { createRequire } from 'node:module';
import { buildRunResult } from '../reporting/aggregate.js';
import { buildRunManifest, buildRunSummary } from '../artifacts/manifest.js';
import { ensureRunDir, ensureScenarioDir, writeManifest, writeScenarioResult, writeSummary } from '../artifacts/writer.js';
import { newRunId } from '../artifacts/run-id.js';
import { collectScenarioResults } from './collect-results.js';
import { parsePlaywrightReport } from './playwright-report.js';
import { runPlaywrightSuite } from './playwright-runner.js';
import { buildVisualRunPlan } from './run-plan.js';
import type { RunRequest, RunResult } from './types.js';

/**
 * All dependencies are optional and default to the real implementation, so
 * `executeRun` stays unit-testable with fully injected fakes while
 * `npm run orchestrate` gets the real Playwright/clock/fs behavior for free.
 */
export interface ExecuteRunDeps {
  now?: () => Date;
  generateRunId?: (now: Date) => string;
  runSuite?: (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<unknown>;
  resolveBrowserInfo?: () => { name: string; version: string };
  ensureRunDir?: typeof ensureRunDir;
  ensureScenarioDir?: typeof ensureScenarioDir;
  writeManifest?: typeof writeManifest;
  writeSummary?: typeof writeSummary;
  writeScenarioResult?: typeof writeScenarioResult;
}

/** Reads the installed `@playwright/test` version; never throws. */
function defaultResolveBrowserInfo(): { name: string; version: string } {
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require('@playwright/test/package.json') as { version?: string };
    return { name: 'chromium', version: packageJson.version ?? '0.0.0' };
  } catch {
    return { name: 'chromium', version: '0.0.0' };
  }
}

/**
 * The execution-run-contract SERVICE: bridges a real Playwright run into a
 * schema-valid domain `RunResult`, persisting `manifest.json`,
 * `summary.json` and one `scenarios/<id>/result.json` per result. See
 * docs/features/execution-run-contract/SPEC.md.
 */
export async function executeRun(request: RunRequest, deps: ExecuteRunDeps = {}): Promise<RunResult> {
  const now = deps.now ?? (() => new Date());
  const generateRunId = deps.generateRunId ?? newRunId;
  const runSuite = deps.runSuite ?? runPlaywrightSuite;
  const resolveBrowserInfo = deps.resolveBrowserInfo ?? defaultResolveBrowserInfo;
  const doEnsureRunDir = deps.ensureRunDir ?? ensureRunDir;
  const doEnsureScenarioDir = deps.ensureScenarioDir ?? ensureScenarioDir;
  const doWriteManifest = deps.writeManifest ?? writeManifest;
  const doWriteSummary = deps.writeSummary ?? writeSummary;
  const doWriteScenarioResult = deps.writeScenarioResult ?? writeScenarioResult;

  const { config, scenarios, updateSnapshots } = request;

  // Fail fast, before any browser process is spawned.
  buildVisualRunPlan({ config, scenarios });

  const startedAt = now();
  const runId = generateRunId(startedAt);

  const args = ['test', 'tests/visual', '--reporter=json', ...(updateSnapshots ? ['--update-snapshots'] : [])];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VISUAL_SCENARIOS: scenarios.map((scenario) => scenario.id).join(',')
  };

  const report = await runSuite(args, env);
  const outcomes = parsePlaywrightReport(report);
  const results = collectScenarioResults(outcomes, scenarios, startedAt.toISOString());

  const finishedAt = now();

  const manifest = buildRunManifest({
    browser: resolveBrowserInfo(),
    config,
    scenarioIds: scenarios.map((scenario) => scenario.id)
  });

  const runResult = buildRunResult({
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    manifest,
    results
  });

  const outputDir = config.artifacts.outputDir;

  await doEnsureRunDir(outputDir, runId);
  for (const result of results) {
    await doEnsureScenarioDir(outputDir, runId, result.scenario.id);
    await doWriteScenarioResult(outputDir, runId, result.scenario.id, result);
  }
  await doWriteManifest(outputDir, runId, manifest);
  await doWriteSummary(
    outputDir,
    runId,
    buildRunSummary({
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      counts: runResult.counts,
      deterministicFailure: runResult.deterministicFailure
    })
  );

  return runResult;
}
