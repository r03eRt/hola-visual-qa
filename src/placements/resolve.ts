import { normalizeError, type NormalizedError } from '../domain/error.js';
import type { PlacementDefinition, PlacementObservation } from './model.js';
import { isPlacementSatisfied } from './state-machine.js';

/**
 * Pure resolution assertion combining the classified placement observation
 * (from `classifyPlacement`) with the definition's satisfaction truth table.
 * See docs/features/playwright-placement-event-bridge/SPEC.md. No
 * DOM/browser/fs/Date/random/env import.
 */

/** Thrown for a terminal, unsatisfied placement — a normalized placement_failure/assertion error. */
export class PlacementResolutionError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string, options?: { evidenceRefs?: string[] }) {
    super(message);
    this.name = 'PlacementResolutionError';
    this.normalized = normalizeError(message, {
      category: 'placement_failure',
      phase: 'assertion',
      evidenceRefs: options?.evidenceRefs
    });
  }
}

/**
 * Throws a `PlacementResolutionError` only when the observation is TERMINAL
 * and not satisfied (e.g. `request_missing`, `empty` without `expectedEmpty`,
 * `provider_error`, `timeout`). A satisfied terminal (`rendered`/`skipped`/an
 * expected `empty`) and every NON-terminal (insufficient-evidence) state are
 * silent — the model never fabricates a failure from missing observations.
 * The message names only the placement id and the state/stage, never any page
 * content or the raw payload.
 */
export function assertPlacementResolved(definition: PlacementDefinition, observation: PlacementObservation): void {
  if (!observation.terminal) {
    return;
  }
  if (isPlacementSatisfied(observation, definition)) {
    return;
  }

  throw new PlacementResolutionError(
    `Placement "${observation.placementId}" not satisfied: ${observation.state} (stage ${observation.stage})`
  );
}
