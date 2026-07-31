/**
 * Deterministic path builders for the committed baseline store (see
 * `docs/features/baseline-update-command/SPEC.md`). Mirrors
 * `src/artifacts/paths.ts`'s traversal-safety approach exactly:
 * `assertSafeSegment`/`assertInside` reject absolute/`..`/separator-injected
 * segments and assert the result stays inside `baselines/`.
 *
 * baselines/
 *   <project>/<baselineName>.png
 *   UPDATE_LOG.jsonl
 */

import path from 'node:path';

export const BASELINES_DIR_NAME = 'baselines';
export const UPDATE_LOG_FILENAME = 'UPDATE_LOG.jsonl';

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
  const segments = value.split(/[\\/]/);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new Error(`${label} must not contain path traversal segments: "${value}"`);
  }
  if (segments.length > 1) {
    throw new Error(`${label} must not contain path separators: "${value}"`);
  }
}

/** Ensures `candidate` resolves to a path inside (or equal to) `root`. */
function assertInside(root: string, candidate: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} would escape the baseline store: "${candidate}"`);
  }
  return resolvedCandidate;
}

/** Absolute path to the committed `baselines/` directory at the repo root. */
export function baselineStoreDir(): string {
  return path.resolve(process.cwd(), BASELINES_DIR_NAME);
}

/** Absolute path to `baselines/<project>/<baselineName>.png`. */
export function baselinePath(project: string, baselineName: string): string {
  assertSafeSegment(project, 'project');
  assertSafeSegment(baselineName, 'baselineName');
  const dir = baselineStoreDir();
  return assertInside(dir, path.join(dir, project, `${baselineName}.png`), 'baselinePath');
}

/** Absolute path to the append-only `baselines/UPDATE_LOG.jsonl` audit log. */
export function auditLogPath(): string {
  const dir = baselineStoreDir();
  return assertInside(dir, path.join(dir, UPDATE_LOG_FILENAME), 'auditLogPath');
}
