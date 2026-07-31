/**
 * Sortable, filesystem-safe, unique run identifiers.
 *
 * Format: `<compact UTC timestamp>-<short random suffix>`, e.g.
 * `20260731T135200Z-a1b2c3`. The timestamp component is derived from
 * `Date#toISOString()` with punctuation stripped (`YYYYMMDDTHHmmssZ`), so
 * lexical (string) sort order matches chronological order for run IDs
 * produced by an increasing clock. The random suffix guarantees uniqueness
 * for run IDs created within the same second (e.g. rapid successive calls).
 */

import { randomBytes } from 'node:crypto';

const TIMESTAMP_PATTERN = '\\d{8}T\\d{6}Z';
const SUFFIX_PATTERN = '[0-9a-f]{6}';

/** Validates the exact `newRunId()` output shape. */
export const RUN_ID_PATTERN = new RegExp(`^${TIMESTAMP_PATTERN}-${SUFFIX_PATTERN}$`);

function compactTimestamp(now: Date): string {
  // '2026-07-31T13:52:00.123Z' -> '20260731T135200Z'
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function randomSuffix(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Creates a new run ID. Accepts an injectable clock (`now`) for
 * deterministic tests; defaults to the current time.
 */
export function newRunId(now: Date = new Date()): string {
  return `${compactTimestamp(now)}-${randomSuffix()}`;
}

/** Returns true when `value` matches the canonical run-id shape. */
export function isRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value);
}
