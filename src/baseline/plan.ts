/**
 * PURE planning for baseline promotion (see
 * `docs/features/baseline-update-command/SPEC.md`). No fs/Date/random/env —
 * existence checks are injected via `PlanInput.baselineExists`/`sourceExists`
 * so this module is trivially unit-testable and never has side effects.
 */

import { normalizeError, type NormalizedError } from '../domain/error.js';
import { baselinePath } from './paths.js';

/** Thrown for any invalid baseline-update planning input — a normalized configuration_error/planning error. */
export class BaselineUpdateError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string, options?: { evidenceRefs?: string[] }) {
    super(message);
    this.name = 'BaselineUpdateError';
    this.normalized = normalizeError(message, {
      category: 'configuration_error',
      phase: 'planning',
      evidenceRefs: options?.evidenceRefs
    });
  }
}

export interface UpdateRequest {
  scenarioId: string;
  targetId: string;
  baselineName: string;
  project: 'desktop-chromium' | 'mobile-chromium' | 'desktop-webkit';
  sourceActualPath: string;
}

export type UpdateActionKind = 'create' | 'overwrite';

export interface PlannedUpdate {
  scenarioId: string;
  targetId: string;
  baselineName: string;
  project: string;
  from: string;
  to: string;
  kind: UpdateActionKind;
}

export interface BaselineUpdatePlan {
  reason: string;
  updates: PlannedUpdate[];
  rejected: { request: UpdateRequest; message: string }[];
}

export interface PlanInput {
  requests: UpdateRequest[];
  reason: string;
  baselineExists: (project: string, baselineName: string) => boolean;
  sourceExists: (sourceActualPath: string) => boolean;
}

/**
 * Builds a `BaselineUpdatePlan` from explicit caller-supplied requests. A
 * request whose source actual is missing is rejected (never fabricated); a
 * request whose baseline already exists is an `overwrite`, otherwise
 * `create`. Deterministic: input order is preserved and no fs/Date/random/env
 * is consulted directly — existence checks are injected.
 */
export function planBaselineUpdate(input: PlanInput): BaselineUpdatePlan {
  const reason = input.reason.trim();
  if (!reason) {
    throw new BaselineUpdateError('A written reason is required to update baselines');
  }

  const updates: PlannedUpdate[] = [];
  const rejected: { request: UpdateRequest; message: string }[] = [];

  for (const request of input.requests) {
    if (!input.sourceExists(request.sourceActualPath)) {
      rejected.push({
        request,
        message: `Source actual not found, nothing to promote: "${request.sourceActualPath}"`
      });
      continue;
    }

    const kind: UpdateActionKind = input.baselineExists(request.project, request.baselineName)
      ? 'overwrite'
      : 'create';

    updates.push({
      scenarioId: request.scenarioId,
      targetId: request.targetId,
      baselineName: request.baselineName,
      project: request.project,
      from: request.sourceActualPath,
      to: baselinePath(request.project, request.baselineName),
      kind
    });
  }

  return { reason, updates, rejected };
}
