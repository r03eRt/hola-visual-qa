/**
 * CLI entry point for explicit, reasoned, audited baseline promotion. See
 * `docs/features/baseline-update-command/SPEC.md` for the full contract.
 * Never launches a browser and never runs automatically — this is the
 * *only* way baselines are ever updated.
 *
 * Flags:
 *   --scenario <id>          repeatable, paired positionally with --target/
 *                             --baseline-name/--source (same order, same count)
 *   --target <targetId>      repeatable
 *   --baseline-name <name>   repeatable
 *   --source <path>          repeatable (the actual.png to promote)
 *   --project <desktop-chromium|mobile-chromium|desktop-webkit|desktop-firefox>
 *   --reason "<text>"        REQUIRED
 *   --yes                    confirm overwriting existing baselines
 *   --dry-run                build + print the plan, touch nothing
 *   --json                   emit a single machine-readable object to stdout
 *   --help                   print usage and exit 0
 *
 * Exit codes: 0 success (>=1 applied or clean dry-run); 2 usage error;
 * 3 nothing to do (empty plan); 4 refused (overwrites present, --yes absent,
 * nothing applied).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planBaselineUpdate, BaselineUpdateError, type UpdateRequest } from './plan.js';
import { applyBaselineUpdate, type FileSystemLike, type Clock } from './apply.js';
import { baselinePath } from './paths.js';

const USAGE = `Usage: npm run baseline:update -- \\
  --scenario <id> --target <targetId> --baseline-name <name> --source <path/to/actual.png> \\
  --project <desktop-chromium|mobile-chromium|desktop-webkit|desktop-firefox> --reason "<why>" [--yes] [--dry-run] [--json]

Flags (--scenario/--target/--baseline-name/--source are repeatable and pair
positionally in the same order; the same count of each is required):
  --scenario <id>            scenario id this baseline belongs to
  --target <targetId>        visual target id (src/visual targetId())
  --baseline-name <name>     baseline name (src/visual baselineName())
  --source <path>            path to the fresh actual.png to promote
  --project <name>           desktop-chromium | mobile-chromium | desktop-webkit | desktop-firefox
  --reason "<text>"          REQUIRED written reason for the update
  --yes                      confirm overwriting an existing baseline
  --dry-run                  build and print the plan, write nothing
  --json                     emit machine-readable JSON to stdout
  --help                     print this usage and exit 0
`;

type Project = 'desktop-chromium' | 'mobile-chromium' | 'desktop-webkit' | 'desktop-firefox';

interface ParsedArgs {
  scenarios: string[];
  targets: string[];
  baselineNames: string[];
  sources: string[];
  project?: string;
  reason?: string;
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    scenarios: [],
    targets: [],
    baselineNames: [],
    sources: [],
    yes: false,
    dryRun: false,
    json: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];

    switch (arg) {
      case '--help':
        parsed.help = true;
        break;
      case '--yes':
        parsed.yes = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--scenario':
        if (value === undefined) throw new UsageError('--scenario requires a value');
        parsed.scenarios.push(value);
        i += 1;
        break;
      case '--target':
        if (value === undefined) throw new UsageError('--target requires a value');
        parsed.targets.push(value);
        i += 1;
        break;
      case '--baseline-name':
        if (value === undefined) throw new UsageError('--baseline-name requires a value');
        parsed.baselineNames.push(value);
        i += 1;
        break;
      case '--source':
        if (value === undefined) throw new UsageError('--source requires a value');
        parsed.sources.push(value);
        i += 1;
        break;
      case '--project':
        if (value === undefined) throw new UsageError('--project requires a value');
        parsed.project = value;
        i += 1;
        break;
      case '--reason':
        if (value === undefined) throw new UsageError('--reason requires a value');
        parsed.reason = value;
        i += 1;
        break;
      default:
        throw new UsageError(`Unknown argument: "${arg}"`);
    }
  }

  return parsed;
}

function buildRequests(parsed: ParsedArgs): UpdateRequest[] {
  const count = parsed.scenarios.length;
  if (
    parsed.targets.length !== count ||
    parsed.baselineNames.length !== count ||
    parsed.sources.length !== count
  ) {
    throw new UsageError(
      '--scenario, --target, --baseline-name and --source must be repeated the same number of times, in the same order'
    );
  }
  if (count === 0) {
    throw new UsageError('At least one --scenario/--target/--baseline-name/--source group is required');
  }
  if (
    parsed.project !== 'desktop-chromium' &&
    parsed.project !== 'mobile-chromium' &&
    parsed.project !== 'desktop-webkit' &&
    parsed.project !== 'desktop-firefox'
  ) {
    throw new UsageError(
      '--project must be "desktop-chromium", "mobile-chromium", "desktop-webkit" or "desktop-firefox"'
    );
  }
  const project: Project = parsed.project;

  return parsed.scenarios.map((scenarioId, i) => ({
    scenarioId,
    targetId: parsed.targets[i],
    baselineName: parsed.baselineNames[i],
    project,
    sourceActualPath: parsed.sources[i]
  }));
}

function readPackageVersion(): string {
  const packageJsonPath = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'package.json');
  const raw = fs.readFileSync(packageJsonPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof (parsed as { version: unknown }).version === 'string'
  ) {
    return (parsed as { version: string }).version;
  }
  return '0.0.0';
}

const realFs: FileSystemLike = {
  exists: (p: string) => fs.existsSync(p),
  mkdirp: (dir: string) => fs.mkdirSync(dir, { recursive: true }),
  copyFile: (from: string, to: string) => fs.copyFileSync(from, to),
  appendFile: (p: string, data: string) => fs.appendFileSync(p, data, 'utf-8')
};

const realClock: Clock = {
  now: () => new Date().toISOString()
};

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }

  const reason = (parsed.reason ?? '').trim();
  if (!reason) {
    throw new UsageError('--reason is required and must not be blank');
  }

  const requests = buildRequests(parsed);

  const plan = planBaselineUpdate({
    requests,
    reason,
    baselineExists: (project, baselineName) => fs.existsSync(baselinePath(project, baselineName)),
    sourceExists: (sourceActualPath) => fs.existsSync(sourceActualPath)
  });

  if (parsed.dryRun) {
    printPlan(plan, parsed.json);
    return plan.updates.length === 0 && plan.rejected.length === 0 ? 3 : 0;
  }

  if (plan.updates.length === 0 && plan.rejected.length === 0) {
    printPlan(plan, parsed.json);
    return 3;
  }

  const result = applyBaselineUpdate(plan, realFs, realClock, {
    allowOverwrite: parsed.yes,
    toolVersion: readPackageVersion(),
    ...(process.env.GITHUB_SHA ? { commitSha: process.env.GITHUB_SHA } : {})
  });

  if (parsed.json) {
    console.log(JSON.stringify({ plan, result }));
  } else {
    console.log(
      `Applied ${result.applied.length} update(s), skipped ${result.skipped.length}, rejected ${plan.rejected.length}`
    );
    for (const update of result.applied) {
      console.log(`  ${update.kind}: ${update.baselineName} (${update.project}) <- ${update.from}`);
    }
    for (const skip of result.skipped) {
      console.error(`  skipped: ${skip.message}`);
    }
    for (const rejection of plan.rejected) {
      console.error(`  rejected: ${rejection.message}`);
    }
  }

  const hadOverwriteRefusal = result.skipped.length > 0 && result.applied.length === 0;
  if (hadOverwriteRefusal) {
    return 4;
  }

  return 0;
}

function printPlan(plan: ReturnType<typeof planBaselineUpdate>, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify({ plan }));
    return;
  }
  console.log(`Baseline update plan (reason: "${plan.reason}")`);
  for (const update of plan.updates) {
    console.log(`  ${update.kind}: ${update.baselineName} (${update.project}) <- ${update.from}`);
  }
  for (const rejection of plan.rejected) {
    console.error(`  rejected: ${rejection.message}`);
  }
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(error.message);
    console.error(USAGE);
    process.exitCode = 2;
  } else if (error instanceof BaselineUpdateError) {
    console.error(error.normalized.message);
    process.exitCode = 2;
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
