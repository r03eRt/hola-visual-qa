import type { PlacementDefinition } from './model.js';
import type { PlacementSignals } from './state-machine.js';
import type { PlacementEventsCollector } from './events.js';

/**
 * Pure request-stage evaluator. See
 * docs/features/placement-request-events/SPEC.md. Maps a
 * `PlacementEventsCollector` snapshot (via `countMatching`) plus
 * `definition.events.request` into a `RequestObservation` for
 * `classifyPlacement`. No DOM/browser/fs/Date/random/env import.
 */
export interface RequestObservation {
  placementId: string;
  /** definition.events?.request ?? null */
  requestSignal: string | null;
  /** undefined when requestSignal === null (not observable). */
  requestObserved: boolean | undefined;
  /** matched events; 0 when not observable. */
  count: number;
}

/**
 * Evaluates the request stage for `definition` against `collector`'s
 * accumulated events. When no approved request signal is configured, the
 * request stage is NOT observable — `requestObserved` stays `undefined` so
 * `classifyPlacement` remains at the non-terminal `container_ready`
 * boundary rather than falsely reporting `request_missing`.
 */
export function evaluateRequest(
  definition: PlacementDefinition,
  collector: PlacementEventsCollector
): RequestObservation {
  const requestSignal = definition.events?.request ?? null;

  if (requestSignal === null) {
    return { placementId: definition.id, requestSignal: null, requestObserved: undefined, count: 0 };
  }

  const count = collector.countMatching(definition.id, requestSignal);
  return { placementId: definition.id, requestSignal, requestObserved: count > 0, count };
}

/** Projects a `RequestObservation` into the `requestObserved` signal `classifyPlacement` consumes. */
export function toRequestSignals(observation: RequestObservation): Pick<PlacementSignals, 'requestObserved'> {
  return { requestObserved: observation.requestObserved };
}
