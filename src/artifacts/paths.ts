/**
 * Deterministic path builders mirroring docs/architecture/ARTIFACT_MODEL.md
 * exactly:
 *
 * <outputDir>/<run-id>/
 *   manifest.json
 *   summary.json
 *   report/index.html
 *   scenarios/<scenario-id>/
 *     result.json
 *     expected.png  actual.png   diff.png
 *     console.json  page-errors.json  requests.json
 *     trace.zip     video.webm   ai-analysis.json
 *
 * All absolute-path helpers are rooted at `outputDir` and validated to never
 * resolve outside the run directory.
 */

import path from 'node:path';
import type { ArtifactRefs } from '../domain/index.js';

export type ArtifactKind = keyof ArtifactRefs;

/** Exact canonical filename for each ArtifactRefs key, per ARTIFACT_MODEL.md. */
export const ARTIFACT_FILENAMES: Record<ArtifactKind, string> = {
  expected: 'expected.png',
  actual: 'actual.png',
  diff: 'diff.png',
  console: 'console.json',
  pageErrors: 'page-errors.json',
  requests: 'requests.json',
  trace: 'trace.zip',
  video: 'video.webm',
  aiAnalysis: 'ai-analysis.json'
};

/** The per-scenario result file, sibling to the artifact files above. */
export const RESULT_FILENAME = 'result.json';
export const MANIFEST_FILENAME = 'manifest.json';
export const SUMMARY_FILENAME = 'summary.json';
export const REPORT_DIR_NAME = 'report';
export const REPORT_INDEX_FILENAME = 'index.html';
export const SCENARIOS_DIR_NAME = 'scenarios';

/**
 * Rejects segments that would escape their parent directory: absolute
 * paths, empty segments, `.`/`..` traversal, and path separators embedded
 * in a single "id" segment.
 */
function assertSafeSegment(value: string, label: string): void {
  if (!value || value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must not be an absolute path: "${value}"`);
  }
  const normalized = value.split(/[\\/]/);
  if (normalized.some((segment) => segment === '..' || segment === '.')) {
    throw new Error(`${label} must not contain path traversal segments: "${value}"`);
  }
  if (normalized.length > 1) {
    throw new Error(`${label} must not contain path separators: "${value}"`);
  }
}

/** Ensures `candidate` resolves to a path inside (or equal to) `root`. */
function assertInside(root: string, candidate: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} would escape the run directory: "${candidate}"`);
  }
  return resolvedCandidate;
}

/** Absolute path to `<outputDir>/<runId>`. */
export function runDir(outputDir: string, runId: string): string {
  assertSafeSegment(runId, 'runId');
  return path.resolve(outputDir, runId);
}

/** Absolute path to `<outputDir>/<runId>/manifest.json`. */
export function manifestPath(outputDir: string, runId: string): string {
  const dir = runDir(outputDir, runId);
  return assertInside(dir, path.join(dir, MANIFEST_FILENAME), 'manifestPath');
}

/** Absolute path to `<outputDir>/<runId>/summary.json`. */
export function summaryPath(outputDir: string, runId: string): string {
  const dir = runDir(outputDir, runId);
  return assertInside(dir, path.join(dir, SUMMARY_FILENAME), 'summaryPath');
}

/** Absolute path to `<outputDir>/<runId>/report/index.html`. */
export function reportIndexPath(outputDir: string, runId: string): string {
  const dir = runDir(outputDir, runId);
  return assertInside(
    dir,
    path.join(dir, REPORT_DIR_NAME, REPORT_INDEX_FILENAME),
    'reportIndexPath'
  );
}

/** Absolute path to `<outputDir>/<runId>/scenarios/<scenarioId>`. */
export function scenarioDir(outputDir: string, runId: string, scenarioId: string): string {
  assertSafeSegment(scenarioId, 'scenarioId');
  const dir = runDir(outputDir, runId);
  return assertInside(dir, path.join(dir, SCENARIOS_DIR_NAME, scenarioId), 'scenarioDir');
}

/** Absolute path to `<outputDir>/<runId>/scenarios/<scenarioId>/result.json`. */
export function scenarioResultPath(outputDir: string, runId: string, scenarioId: string): string {
  const dir = scenarioDir(outputDir, runId, scenarioId);
  return assertInside(runDir(outputDir, runId), path.join(dir, RESULT_FILENAME), 'scenarioResultPath');
}

/**
 * Absolute path to a scenario artifact file, e.g.
 * `<outputDir>/<runId>/scenarios/<scenarioId>/actual.png`.
 */
export function scenarioArtifactPath(
  outputDir: string,
  runId: string,
  scenarioId: string,
  kind: ArtifactKind
): string {
  const filename = ARTIFACT_FILENAMES[kind];
  if (!filename) {
    throw new Error(`Unknown artifact kind: "${String(kind)}"`);
  }
  const dir = scenarioDir(outputDir, runId, scenarioId);
  return assertInside(runDir(outputDir, runId), path.join(dir, filename), 'scenarioArtifactPath');
}

/**
 * Path to a scenario artifact RELATIVE to the run directory, e.g.
 * `scenarios/<scenarioId>/actual.png`. Suitable for a domain `ArtifactRefs`
 * value, which forbids absolute paths.
 */
export function relativeArtifactRef(scenarioId: string, kind: ArtifactKind): string {
  assertSafeSegment(scenarioId, 'scenarioId');
  const filename = ARTIFACT_FILENAMES[kind];
  if (!filename) {
    throw new Error(`Unknown artifact kind: "${String(kind)}"`);
  }
  return path.posix.join(SCENARIOS_DIR_NAME, scenarioId, filename);
}

/**
 * Assembles an `ArtifactRefs` object (relative paths) for the given set of
 * artifact kinds present for a scenario.
 */
export function buildArtifactRefs(
  scenarioId: string,
  kinds: readonly ArtifactKind[]
): ArtifactRefs {
  const refs: ArtifactRefs = {};
  for (const kind of kinds) {
    refs[kind] = relativeArtifactRef(scenarioId, kind);
  }
  return refs;
}
