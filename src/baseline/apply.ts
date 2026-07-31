/**
 * Impure shell over `planBaselineUpdate`'s output (see
 * `docs/features/baseline-update-command/SPEC.md`). All side effects go
 * through the injected `FileSystemLike`/`Clock` — no direct `node:fs`/`Date`
 * in this module — so unit tests can inject an in-memory fake and stay
 * hermetic.
 */

import path from 'node:path';
import type { BaselineUpdatePlan, PlannedUpdate, UpdateActionKind } from './plan.js';
import { auditLogPath } from './paths.js';

export interface FileSystemLike {
  exists(path: string): boolean;
  mkdirp(dir: string): void;
  copyFile(from: string, to: string): void;
  appendFile(path: string, data: string): void;
}

/** Supplies the current time as an ISO timestamp. */
export interface Clock {
  now(): string;
}

export interface ApplyOptions {
  /** From `--yes`: whether `overwrite` updates are allowed to apply. */
  allowOverwrite: boolean;
  /** Caller supplies (package version). */
  toolVersion: string;
  /** Optional, may be absent. */
  commitSha?: string;
}

export interface AuditEntry {
  timestamp: string;
  reason: string;
  toolVersion: string;
  commitSha?: string;
  updates: {
    scenarioId: string;
    targetId: string;
    baselineName: string;
    project: string;
    kind: UpdateActionKind;
  }[];
}

export interface ApplyResult {
  applied: PlannedUpdate[];
  skipped: { update: PlannedUpdate; message: string }[];
  audit?: AuditEntry;
}

/**
 * Applies a `BaselineUpdatePlan`: `overwrite` updates are skipped unless
 * `opts.allowOverwrite` is true; `create` updates always apply. Each applied
 * update is `mkdirp(dirname(to))` then `copyFile(from, to)`. If at least one
 * update was applied, exactly one secret-free JSON audit line is appended to
 * `auditLogPath()`; otherwise no audit line is written.
 */
export function applyBaselineUpdate(
  plan: BaselineUpdatePlan,
  fs: FileSystemLike,
  clock: Clock,
  opts: ApplyOptions
): ApplyResult {
  const applied: PlannedUpdate[] = [];
  const skipped: { update: PlannedUpdate; message: string }[] = [];

  for (const update of plan.updates) {
    if (update.kind === 'overwrite' && !opts.allowOverwrite) {
      skipped.push({
        update,
        message: `Refusing to overwrite existing baseline "${update.baselineName}" for ${update.project} without --yes`
      });
      continue;
    }

    fs.mkdirp(path.dirname(update.to));
    fs.copyFile(update.from, update.to);
    applied.push(update);
  }

  if (applied.length === 0) {
    return { applied, skipped };
  }

  const audit: AuditEntry = {
    timestamp: clock.now(),
    reason: plan.reason,
    toolVersion: opts.toolVersion,
    ...(opts.commitSha !== undefined ? { commitSha: opts.commitSha } : {}),
    updates: applied.map((update) => ({
      scenarioId: update.scenarioId,
      targetId: update.targetId,
      baselineName: update.baselineName,
      project: update.project,
      kind: update.kind
    }))
  };

  fs.appendFile(auditLogPath(), `${JSON.stringify(audit)}\n`);

  return { applied, skipped, audit };
}
