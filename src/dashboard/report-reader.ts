import { readdir as fsReaddir, readFile as fsReadFile, stat as fsStat } from 'node:fs/promises';
import {
  manifestPath,
  runDir,
  scenarioResultPath,
  summaryPath
} from '../artifacts/paths.js';
import {
  parseRunManifest,
  parseRunResult,
  parseRunSummary,
  parseScenarioResult,
  type RunResult,
  type RunSummary,
  type ScenarioResult
} from '../domain/index.js';

/**
 * IMPURE reader for the read-only report viewer (#32 /
 * docs/features/local-dashboard-report-viewer/SPEC.md). Every disk path is
 * built via `../artifacts/paths.js`, which validates run-id/scenario-id
 * segments (`assertSafeSegment`) — an unsafe or absent run-id, or any
 * missing/invalid file, is mapped to `undefined` here rather than a thrown
 * error or a leaked path/stack.
 */

export interface ReportReaderDeps {
  outputDir: string;
  readdir?: (dir: string) => Promise<string[]>;
  readFile?: (path: string) => Promise<string>;
  statIsDir?: (path: string) => Promise<boolean>;
}

export interface RunListEntry {
  summary: RunSummary;
}

async function defaultReaddir(dir: string): Promise<string[]> {
  return fsReaddir(dir);
}

async function defaultReadFile(path: string): Promise<string> {
  return fsReadFile(path, 'utf8');
}

async function defaultStatIsDir(path: string): Promise<boolean> {
  const stats = await fsStat(path);
  return stats.isDirectory();
}

function resolvedDeps(deps: ReportReaderDeps): Required<ReportReaderDeps> {
  return {
    outputDir: deps.outputDir,
    readdir: deps.readdir ?? defaultReaddir,
    readFile: deps.readFile ?? defaultReadFile,
    statIsDir: deps.statIsDir ?? defaultStatIsDir
  };
}

async function readJson(readFile: (path: string) => Promise<string>, path: string): Promise<unknown> {
  const raw = await readFile(path);
  return JSON.parse(raw);
}

/**
 * Lists all persisted runs' summaries, sorted by `runId` descending
 * (run-ids are `YYYYMMDDTHHmmssZ-<hex>`, so this is newest-first). A
 * partially-written or invalid run directory is silently skipped rather
 * than breaking the whole list.
 */
export async function listRuns(deps: ReportReaderDeps): Promise<RunSummary[]> {
  const { outputDir, readdir, readFile } = resolvedDeps(deps);

  let names: string[];
  try {
    names = await readdir(outputDir);
  } catch {
    return [];
  }

  const summaries: RunSummary[] = [];

  for (const name of names) {
    let path: string;
    try {
      path = summaryPath(outputDir, name);
    } catch {
      // assertSafeSegment rejected this entry name — skip it.
      continue;
    }

    try {
      const json = await readJson(readFile, path);
      summaries.push(parseRunSummary(json));
    } catch {
      // Missing/unreadable/invalid summary.json — skip this run.
      continue;
    }
  }

  return summaries.sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
}

/**
 * Reads and reassembles a single run's full `RunResult` from its persisted
 * manifest/summary/scenario results. Any failure — an unsafe run-id, an
 * absent run directory, a missing/invalid manifest or summary, or a
 * missing/invalid result.json for any of the manifest's scenario ids —
 * resolves to `undefined` (mapped to a 404 by the router), never a thrown
 * error.
 */
export async function readRun(runId: string, deps: ReportReaderDeps): Promise<RunResult | undefined> {
  const { outputDir, readFile } = resolvedDeps(deps);

  let manifestFile: string;
  let summaryFile: string;
  try {
    manifestFile = manifestPath(outputDir, runId);
    summaryFile = summaryPath(outputDir, runId);
    // Ensure runId itself is safe even if the two builders above somehow
    // did not throw (defensive; both already validate).
    runDir(outputDir, runId);
  } catch {
    return undefined;
  }

  let manifest;
  let summary;
  try {
    manifest = parseRunManifest(await readJson(readFile, manifestFile));
    summary = parseRunSummary(await readJson(readFile, summaryFile));
  } catch {
    return undefined;
  }

  const results: ScenarioResult[] = [];
  for (const scenarioId of manifest.scenarioIds) {
    let resultFile: string;
    try {
      resultFile = scenarioResultPath(outputDir, runId, scenarioId);
    } catch {
      return undefined;
    }

    try {
      const json = await readJson(readFile, resultFile);
      results.push(parseScenarioResult(json));
    } catch {
      // Missing/invalid result.json for a listed scenario => incomplete run.
      return undefined;
    }
  }

  try {
    return parseRunResult({
      runId,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      manifest,
      results,
      counts: summary.counts,
      deterministicFailure: summary.deterministicFailure
    });
  } catch {
    return undefined;
  }
}
