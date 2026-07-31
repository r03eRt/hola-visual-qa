/**
 * Concise, secret-free, human-readable CLI summary for a `RunResult`, plus
 * the process exit code that follows from its deterministic-failure flag.
 * See docs/features/run-summary/SPEC.md.
 */

import type { RunResult } from '../domain/index.js';
import { groupFailuresByPage } from './aggregate.js';

/**
 * One concise, multi-line, secret-free human summary. Never prints artifact
 * contents, headers, cookies or URLs with query strings — only ids, counts,
 * page paths and category names.
 */
export function formatCliSummary(run: RunResult): string {
  const { counts } = run;
  const lines: string[] = [
    `Run ${run.runId}: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped (${counts.total} total)`,
    run.deterministicFailure ? 'Result: FAIL (deterministic)' : 'Result: PASS'
  ];

  const groups = groupFailuresByPage(run.results);

  if (groups.length > 0) {
    lines.push('Failures by page:');
    for (const group of groups) {
      const pageLabel = group.pageName !== undefined ? `${group.page} [${group.pageName}]` : group.page;
      const categories = group.failures.map((failure) => failure.category).join(', ');
      lines.push(`  ${pageLabel}: ${group.failures.length} (${categories})`);
    }
  }

  return lines.join('\n');
}

/** 0 when run.deterministicFailure is false, else 1. */
export function exitCodeForRun(run: RunResult): number {
  return run.deterministicFailure ? 1 : 0;
}
