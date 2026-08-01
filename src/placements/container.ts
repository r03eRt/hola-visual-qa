import type { Scenario } from '../domain/index.js';
import { normalizeError, type NormalizedError } from '../domain/error.js';
import type { PlacementDefinition, PlacementSize } from './model.js';
import type { PlacementSignals } from './state-machine.js';

/**
 * DI structural interfaces for the container-stage reader. See
 * docs/features/placement-container-checks/SPEC.md and
 * docs/ads/PLACEMENT_MODEL.md. A real Playwright `Page`/`Locator` satisfies
 * these shapes, but no browser is used or imported here/in tests.
 */
export interface PlacementBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacementLocatorLike {
  count(): Promise<number>;
  first(): PlacementLocatorLike;
  isVisible(): Promise<boolean>;
  boundingBox(): Promise<PlacementBoundingBox | null>;
}

export interface PlacementContainerPageLike {
  locator(selector: string): PlacementLocatorLike;
}

/** Raw, unevaluated observation gathered by `readContainerState`. */
export interface RawContainerState {
  present: boolean;
  visible: boolean;
  box: { width: number; height: number } | null;
}

/**
 * Pure evaluation of a placement's container stage: presence, visibility (per
 * device expectation) and rendered size (against `allowedSizes`, within
 * tolerance). Only the placement id, device, booleans and numeric sizes are
 * ever included — never the raw selector value or page content.
 */
export interface ContainerObservation {
  placementId: string;
  device: Scenario['device'];
  expectedVisible: boolean;
  present: boolean;
  visible: boolean;
  size: { width: number; height: number } | null;
  matchedSize: PlacementSize | null;
  sizeAllowed: boolean;
  containerFound: boolean;
  applicableOnDevice: boolean;
  satisfied: boolean;
  reason?: string;
}

export interface ContainerCheckOptions {
  tolerancePx?: number;
}

const DEFAULT_TOLERANCE_PX = 1;

/**
 * Single-shot, dependency-injected reader of the container's raw DOM state.
 * Short-circuits to `{present:false, visible:false, box:null}` without
 * calling `isVisible`/`boundingBox` when the locator matches nothing — no
 * waiting/polling/timeouts (that is a later, request/render concern).
 */
export async function readContainerState(
  page: PlacementContainerPageLike,
  definition: PlacementDefinition
): Promise<RawContainerState> {
  const loc = page.locator(definition.containerSelector);
  const present = (await loc.count()) > 0;

  if (!present) {
    return { present: false, visible: false, box: null };
  }

  const visible = await loc.first().isVisible();
  const bb = await loc.first().boundingBox();
  const box = bb ? { width: Math.round(bb.width), height: Math.round(bb.height) } : null;

  return { present, visible, box };
}

function findMatchedSize(
  box: { width: number; height: number } | null,
  allowedSizes: readonly PlacementSize[],
  tol: number
): PlacementSize | null {
  if (box === null) {
    return null;
  }

  return (
    allowedSizes.find(
      (size) => Math.abs(box.width - size.width) <= tol && Math.abs(box.height - size.height) <= tol
    ) ?? null
  );
}

/**
 * Pure evaluator: maps raw observations + the per-device visibility
 * expectation + `allowedSizes` into a `ContainerObservation`, including the
 * `containerFound` signal `classifyPlacement` consumes. See SPEC "Behaviour —
 * evaluateContainer rules" for the exact, verbatim rules this implements.
 */
export function evaluateContainer(
  definition: PlacementDefinition,
  device: Scenario['device'],
  raw: RawContainerState,
  options?: ContainerCheckOptions
): ContainerObservation {
  const expectedVisible = definition.visibility[device];
  const tol = options?.tolerancePx ?? DEFAULT_TOLERANCE_PX;

  const matchedSize = findMatchedSize(raw.box, definition.allowedSizes, tol);
  const sizeAllowed = matchedSize !== null;
  const containerFound = raw.present && raw.visible;
  const applicableOnDevice = expectedVisible;

  let satisfied: boolean;
  let reason: string | undefined;

  if (expectedVisible) {
    satisfied = containerFound && sizeAllowed;
    if (!satisfied) {
      if (!raw.present) {
        reason = 'container missing';
      } else if (!raw.visible) {
        reason = 'container not visible';
      } else {
        reason = raw.box === null ? 'size not allowed (not measurable)' : `size not allowed (observed ${raw.box.width}x${raw.box.height})`;
      }
    }
  } else {
    satisfied = !raw.visible;
    if (!satisfied) {
      reason = `unexpectedly visible on ${device}`;
    }
  }

  return {
    placementId: definition.id,
    device,
    expectedVisible,
    present: raw.present,
    visible: raw.visible,
    size: raw.box,
    matchedSize,
    sizeAllowed,
    containerFound,
    applicableOnDevice,
    satisfied,
    ...(reason !== undefined ? { reason } : {})
  };
}

/** Thrown for a failed container-stage check — a normalized placement_failure/assertion error. */
export class PlacementContainerError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string, options?: { evidenceRefs?: string[] }) {
    super(message);
    this.name = 'PlacementContainerError';
    this.normalized = normalizeError(message, {
      category: 'placement_failure',
      phase: 'assertion',
      evidenceRefs: options?.evidenceRefs
    });
  }
}

/**
 * Throws a `PlacementContainerError` when the container stage is not
 * satisfied; the message names only the placement id and the report-safe
 * `reason` (never the selector value or any page content).
 */
export function assertContainer(observation: ContainerObservation): void {
  if (observation.satisfied) {
    return;
  }

  throw new PlacementContainerError(`Placement "${observation.placementId}" container check failed: ${observation.reason}`);
}

/**
 * Small pure helper deriving the two `PlacementSignals` fields the container
 * stage produces, ready to feed `classifyPlacement`.
 */
export function toContainerSignals(observation: ContainerObservation): Pick<PlacementSignals, 'applicable' | 'containerFound'> {
  return { applicable: observation.applicableOnDevice, containerFound: observation.containerFound };
}
