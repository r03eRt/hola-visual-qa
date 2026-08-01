import { normalizeError, type NormalizedError } from '../domain/error.js';
import {
  PlacementDefinitionSchema,
  type PlacementDefinition,
  type PlacementObservation,
  type PlacementState,
  type PlacementStage
} from './model.js';
import { z } from 'zod';

/**
 * Pure classifier for observed placement signals. See
 * docs/ads/PLACEMENT_MODEL.md for the state machine this encodes verbatim
 * and docs/features/placement-contract/SPEC.md for the exact gate order.
 * No DOM access, no event listening, no browser, no timing work — this
 * module only classifies already-observed signals.
 */

export interface PlacementSignals {
  /** Whether this placement is expected on the current page/context. */
  applicable: boolean;
  /** Container-stage observation; undefined = not yet observed. */
  containerFound?: boolean;
  /** Request-stage observation; undefined = not yet observed. */
  requestObserved?: boolean;
  /** Render-stage outcome; undefined = not yet observed. */
  renderOutcome?: 'rendered' | 'empty' | 'provider_error' | 'timeout';
}

/** The terminal states of the placement state machine — see PLACEMENT_MODEL.md. */
export const TERMINAL_PLACEMENT_STATES: ReadonlySet<PlacementState> = new Set<PlacementState>([
  'skipped',
  'container_missing',
  'request_missing',
  'rendered',
  'empty',
  'provider_error',
  'timeout'
]);

function buildObservation(
  placementId: string,
  state: PlacementState,
  stage: PlacementStage,
  terminal: boolean
): PlacementObservation {
  return { placementId, state, stage, terminal };
}

/**
 * Classifies observed signals into a single terminal or non-terminal
 * `PlacementObservation`, evaluating signals strictly in stage order. A gate
 * that observes a failure yields a terminal state and later signals are
 * ignored; a gate whose signal is `undefined` yields the non-terminal
 * boundary node awaiting that stage. See SPEC "Behaviour — the state
 * machine" for the exact, verbatim switch this implements.
 */
export function classifyPlacement(placementId: string, signals: PlacementSignals): PlacementObservation {
  // 1. Not applicable on this page/context — terminal, no further checks apply.
  if (signals.applicable === false) {
    return buildObservation(placementId, 'skipped', 'applicability', true);
  }

  // 2. Container stage: explicit absence is terminal.
  if (signals.containerFound === false) {
    return buildObservation(placementId, 'container_missing', 'container', true);
  }

  // 3. Container not yet confirmed found — non-terminal, awaiting container.
  if (signals.containerFound !== true) {
    return buildObservation(placementId, 'container_ready', 'container', false);
  }

  // Container confirmed found.

  // 4. Request stage: explicit absence is terminal.
  if (signals.requestObserved === false) {
    return buildObservation(placementId, 'request_missing', 'request', true);
  }

  // 5. Request not yet confirmed observed — non-terminal, awaiting request.
  if (signals.requestObserved !== true) {
    return buildObservation(placementId, 'container_ready', 'request', false);
  }

  // Request confirmed observed.

  // 6. Render stage: each outcome is terminal.
  if (signals.renderOutcome === 'rendered') {
    return buildObservation(placementId, 'rendered', 'render', true);
  }
  if (signals.renderOutcome === 'empty') {
    return buildObservation(placementId, 'empty', 'render', true);
  }
  if (signals.renderOutcome === 'provider_error') {
    return buildObservation(placementId, 'provider_error', 'render', true);
  }
  if (signals.renderOutcome === 'timeout') {
    return buildObservation(placementId, 'timeout', 'render', true);
  }

  // 7. Render outcome not yet observed — non-terminal, awaiting render.
  return buildObservation(placementId, 'requested', 'render', false);
}

/**
 * Whether a classified observation counts as the placement's contract being
 * satisfied, per the SPEC's truth table: `skipped`/`rendered` are always
 * satisfied, `empty` only when the definition documents it as expected, and
 * every other terminal or non-terminal (incomplete) state is not satisfied.
 */
export function isPlacementSatisfied(observation: PlacementObservation, definition: PlacementDefinition): boolean {
  switch (observation.state) {
    case 'skipped':
    case 'rendered':
      return true;
    case 'empty':
      return definition.expectedEmpty;
    default:
      return false;
  }
}

/** Thrown for any invalid `PlacementDefinition` input — a normalized configuration_error/planning error. */
export class PlacementDefinitionError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string, options?: { evidenceRefs?: string[] }) {
    super(message);
    this.name = 'PlacementDefinitionError';
    this.normalized = normalizeError(message, {
      category: 'configuration_error',
      phase: 'planning',
      evidenceRefs: options?.evidenceRefs
    });
  }
}

/**
 * Parses a `PlacementDefinition`, throwing a normalized
 * `PlacementDefinitionError` on invalid input. The message names the
 * offending field path(s) only — it NEVER includes the supplied (possibly
 * secret-shaped) value.
 */
export function parsePlacementDefinitionOrThrow(input: unknown): PlacementDefinition {
  const result = PlacementDefinitionSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  const paths = result.error.issues.map((issue: z.ZodIssue) => (issue.path.length > 0 ? issue.path.join('.') : '(root)'));
  const uniquePaths = Array.from(new Set(paths));
  throw new PlacementDefinitionError(`Invalid PlacementDefinition: invalid field(s) ${uniquePaths.join(', ')}`);
}
