/**
 * Filesystem writers for the artifact layout. Every write is rooted at
 * `outputDir` (validated by the path builders in `./paths.js`) and never
 * deletes or prunes existing files.
 */

import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunManifest, RunSummary } from '../domain/index.js';
import { manifestPath, reportIndexPath, runDir, scenarioDir, summaryPath } from './paths.js';

/** Creates `<outputDir>/<runId>` and `<outputDir>/<runId>/report`. */
export async function ensureRunDir(outputDir: string, runId: string): Promise<string> {
  const dir = runDir(outputDir, runId);
  await mkdir(dir, { recursive: true });
  await mkdir(path.dirname(reportIndexPath(outputDir, runId)), { recursive: true });
  return dir;
}

/** Creates `<outputDir>/<runId>/scenarios/<scenarioId>`. */
export async function ensureScenarioDir(
  outputDir: string,
  runId: string,
  scenarioId: string
): Promise<string> {
  const dir = scenarioDir(outputDir, runId, scenarioId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Writes `content` to `destinationPath` atomically: write to a sibling
 * temp file, then rename over the destination. Avoids partially-written
 * files if the process is interrupted mid-write.
 */
async function writeFileAtomic(destinationPath: string, content: string): Promise<void> {
  const dir = path.dirname(destinationPath);
  await mkdir(dir, { recursive: true });
  const tempDir = await mkdtemp(path.join(dir, '.tmp-'));
  const tempFile = path.join(tempDir, path.basename(destinationPath));
  try {
    await writeFile(tempFile, content, 'utf8');
    await rename(tempFile, destinationPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Writes `manifest.json` atomically and returns the absolute path written. */
export async function writeManifest(
  outputDir: string,
  runId: string,
  manifest: RunManifest
): Promise<string> {
  const destination = manifestPath(outputDir, runId);
  await writeFileAtomic(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  return destination;
}

/** Writes `summary.json` atomically and returns the absolute path written. */
export async function writeSummary(
  outputDir: string,
  runId: string,
  summary: RunSummary
): Promise<string> {
  const destination = summaryPath(outputDir, runId);
  await writeFileAtomic(destination, `${JSON.stringify(summary, null, 2)}\n`);
  return destination;
}
