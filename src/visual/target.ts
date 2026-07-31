import { normalizeError, type NormalizedError } from '../domain/error.js';

/**
 * The four screenshot target kinds this feature can resolve. `full-page` and
 * `viewport` capture the whole page/viewport; `component` and `ad-placement`
 * capture a named, selector-scoped region (see `plan.ts#resolveTargetPlan`).
 */
export type VisualTarget =
  | { kind: 'full-page' }
  | { kind: 'viewport' }
  | { kind: 'component'; name: string; selector: string }
  | { kind: 'ad-placement'; name: string; selector: string };

/** Thrown for any invalid `VisualTarget`/plan input — a normalized configuration_error/planning error. */
export class VisualTargetError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string, options?: { evidenceRefs?: string[] }) {
    super(message);
    this.name = 'VisualTargetError';
    this.normalized = normalizeError(message, {
      category: 'configuration_error',
      phase: 'planning',
      evidenceRefs: options?.evidenceRefs
    });
  }
}

/** Lowercase, `[a-z0-9]+` runs joined by `-`, trimmed of leading/trailing dashes. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Stable, filesystem-safe slug identifying a `VisualTarget`, used to name its
 * baseline/artifacts. `full-page` -> `full-page`, `viewport` -> `viewport`,
 * `component` -> `component-<slug(name)>`, `ad-placement` -> `ad-<slug(name)>`.
 * Throws `VisualTargetError` if a named target's `name`/`selector` is empty
 * (after trimming) or if the resulting slug is empty.
 */
export function targetId(target: VisualTarget): string {
  if (target.kind === 'full-page' || target.kind === 'viewport') {
    return target.kind;
  }

  const { name, selector } = target;
  if (!name.trim()) {
    throw new VisualTargetError(`${target.kind} target requires a non-empty name`);
  }
  if (!selector.trim()) {
    throw new VisualTargetError(`${target.kind} target "${name}" requires a non-empty selector`);
  }

  const slug = slugify(name);
  if (!slug) {
    throw new VisualTargetError(`${target.kind} target name "${name}" produced an empty slug`);
  }

  const prefix = target.kind === 'component' ? 'component' : 'ad';
  return `${prefix}-${slug}`;
}
