import type { PlacementDefinition } from './model.js';
import type { PlacementSignals } from './state-machine.js';
import type { PlacementEventsCollector } from './events.js';

/**
 * Pure render-stage evaluator. See
 * docs/features/placement-render-events/SPEC.md. Maps a
 * `PlacementEventsCollector` snapshot (via `countMatching`) plus
 * `definition.events.render` into a `RenderObservation` for
 * `classifyPlacement`. REUSES the #17 `PlacementEventsCollector` unchanged.
 * No DOM/browser/fs/Date/random/env import.
 */
export type RenderOutcome = 'rendered' | 'empty' | 'provider_error' | 'timeout';

/** Approved outcome tokens in SEVERITY precedence order (most severe first). */
export const RENDER_OUTCOMES: readonly RenderOutcome[] = ['provider_error', 'timeout', 'empty', 'rendered'];

/** The approved emitted signal name for a render outcome under a base name. */
export function renderOutcomeSignal(base: string, outcome: RenderOutcome): string {
  return `${base}:${outcome}`;
}

export interface RenderObservation {
  placementId: string;
  /** definition.events?.render ?? null (the base) */
  renderSignal: string | null;
  /** undefined when renderSignal === null OR no outcome observed. */
  renderOutcome: RenderOutcome | undefined;
  /** per-outcome observed counts (diagnosis; 0s when not observable). */
  counts: Record<RenderOutcome, number>;
}

const ZERO_COUNTS: Record<RenderOutcome, number> = {
  rendered: 0,
  empty: 0,
  provider_error: 0,
  timeout: 0
};

/**
 * Evaluates the render stage for `definition` against `collector`'s
 * accumulated events. When no approved render base signal is configured, the
 * render stage is NOT observable — `renderOutcome` stays `undefined` so
 * `classifyPlacement` remains at the non-terminal `requested` boundary
 * rather than fabricating a `timeout`/failure.
 */
export function evaluateRender(
  definition: PlacementDefinition,
  collector: PlacementEventsCollector
): RenderObservation {
  const renderSignal = definition.events?.render ?? null;

  if (renderSignal === null) {
    return { placementId: definition.id, renderSignal: null, renderOutcome: undefined, counts: { ...ZERO_COUNTS } };
  }

  const counts: Record<RenderOutcome, number> = { ...ZERO_COUNTS };
  for (const outcome of RENDER_OUTCOMES) {
    counts[outcome] = collector.countMatching(definition.id, renderOutcomeSignal(renderSignal, outcome));
  }

  const renderOutcome = RENDER_OUTCOMES.find(outcome => counts[outcome] > 0);

  return { placementId: definition.id, renderSignal, renderOutcome, counts };
}

/** Projects a `RenderObservation` into the `renderOutcome` signal `classifyPlacement` consumes. */
export function toRenderSignals(observation: RenderObservation): Pick<PlacementSignals, 'renderOutcome'> {
  return { renderOutcome: observation.renderOutcome };
}
