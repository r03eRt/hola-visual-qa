import type { PlacementDefinition } from './model.js';
import { type PlacementBoundingBox, type PlacementContainerPageLike } from './container.js';
import { normalizeError, type NormalizedError } from '../domain/error.js';

/**
 * Additive, hermetic layout-shift evaluator for a placement. See
 * docs/features/placement-layout-shift/SPEC.md. This module is
 * INDEPENDENT of the `classifyPlacement` state machine — layout shift is a
 * quality signal, not a stage transition — so it does not feed
 * `PlacementSignals` and does not modify `state-machine.ts`, `model.ts`,
 * `events.ts`, `container.ts`, `request.ts` or `render.ts`. Mirrors the
 * reader-DI + pure-evaluator split already used by `container.ts`, reusing
 * its `PlacementBoundingBox` / `PlacementContainerPageLike` DI shapes.
 */

export type LayoutShiftLevel = 'none' | 'within_tolerance' | 'exceeded';

/** One selector's before/after boxes and derived top-left displacement. */
export interface RegionDisplacement {
  /** 'container' for the placement container, otherwise a protected-region
   *  index label like 'protected[0]'. The raw selector value is NEVER stored. */
  label: string;
  before: PlacementBoundingBox | null;
  after: PlacementBoundingBox | null;
  /** rounded Euclidean top-left displacement, or null when not measurable. */
  displacementPx: number | null;
}

/** Raw single-snapshot geometry gathered by readLayoutSnapshot. */
export interface RawLayoutSnapshot {
  container: PlacementBoundingBox | null;
  protectedRegions: (PlacementBoundingBox | null)[];
}

export interface LayoutShiftObservation {
  placementId: string;
  regions: RegionDisplacement[];
  /** max measurable displacement across regions, or null when none measurable. */
  maxDisplacementPx: number | null;
  measurable: boolean;
  tolerancePx: number;
  level: LayoutShiftLevel;
  satisfied: boolean;
  reason?: string;
}

export interface LayoutShiftOptions {
  tolerancePx?: number; // default 2, integer >= 0
}

const DEFAULT_TOLERANCE_PX = 2;

async function readBox(page: PlacementContainerPageLike, selector: string): Promise<PlacementBoundingBox | null> {
  const loc = page.locator(selector);
  const present = (await loc.count()) > 0;

  if (!present) {
    return null;
  }

  const bb = await loc.first().boundingBox();
  return bb
    ? { x: Math.round(bb.x), y: Math.round(bb.y), width: Math.round(bb.width), height: Math.round(bb.height) }
    : null;
}

/**
 * Single-shot, dependency-injected reader of the container + protectedRegions
 * raw geometry. Short-circuits to `null` without calling `boundingBox` on a
 * zero-match locator. No waiting/polling/timeouts and no visibility check —
 * movement of a hidden-but-present element still matters; presence gates
 * measurability.
 */
export async function readLayoutSnapshot(
  page: PlacementContainerPageLike,
  definition: PlacementDefinition
): Promise<RawLayoutSnapshot> {
  const container = await readBox(page, definition.containerSelector);

  const protectedRegions: (PlacementBoundingBox | null)[] = [];
  for (const selector of definition.protectedRegions) {
    protectedRegions.push(await readBox(page, selector));
  }

  return { container, protectedRegions };
}

function displacementBetween(before: PlacementBoundingBox | null, after: PlacementBoundingBox | null): number | null {
  if (before === null || after === null) {
    return null;
  }

  return Math.round(Math.sqrt((after.x - before.x) ** 2 + (after.y - before.y) ** 2));
}

/**
 * Pure evaluator over two snapshots. See SPEC "evaluateLayoutShift rules
 * (verbatim)" for the exact classification this implements.
 */
export function evaluateLayoutShift(
  definition: PlacementDefinition,
  before: RawLayoutSnapshot,
  after: RawLayoutSnapshot,
  options?: LayoutShiftOptions
): LayoutShiftObservation {
  const regions: RegionDisplacement[] = [
    {
      label: 'container',
      before: before.container,
      after: after.container,
      displacementPx: displacementBetween(before.container, after.container)
    },
    ...definition.protectedRegions.map((_selector, i) => {
      const beforeBox = before.protectedRegions[i] ?? null;
      const afterBox = after.protectedRegions[i] ?? null;
      return {
        label: `protected[${i}]`,
        before: beforeBox,
        after: afterBox,
        displacementPx: displacementBetween(beforeBox, afterBox)
      };
    })
  ];

  const measurableDisplacements = regions
    .map((r) => r.displacementPx)
    .filter((d): d is number => d !== null);

  const maxDisplacementPx = measurableDisplacements.length > 0 ? Math.max(...measurableDisplacements) : null;
  const measurable = maxDisplacementPx !== null;
  const tolerancePx = Math.max(0, Math.trunc(options?.tolerancePx ?? DEFAULT_TOLERANCE_PX));

  let level: LayoutShiftLevel;
  if (!measurable || maxDisplacementPx === 0) {
    level = 'none';
  } else if (maxDisplacementPx <= tolerancePx) {
    level = 'within_tolerance';
  } else {
    level = 'exceeded';
  }

  const satisfied = level !== 'exceeded';
  const reason = level === 'exceeded' ? `layout shift ${maxDisplacementPx}px exceeds tolerance ${tolerancePx}px` : undefined;

  return {
    placementId: definition.id,
    regions,
    maxDisplacementPx,
    measurable,
    tolerancePx,
    level,
    satisfied,
    ...(reason !== undefined ? { reason } : {})
  };
}

/** Thrown for a failed layout-shift check — a normalized placement_failure/assertion error. */
export class PlacementLayoutShiftError extends Error {
  readonly normalized: NormalizedError;

  constructor(message: string, options?: { evidenceRefs?: string[] }) {
    super(message);
    this.name = 'PlacementLayoutShiftError';
    this.normalized = normalizeError(message, {
      category: 'placement_failure',
      phase: 'assertion',
      evidenceRefs: options?.evidenceRefs
    });
  }
}

/**
 * Throws a `PlacementLayoutShiftError` when the level is `exceeded`; the
 * message names only the placement id and the report-safe `reason` (never a
 * selector value or any page content).
 */
export function assertLayoutShift(observation: LayoutShiftObservation): void {
  if (observation.satisfied) {
    return;
  }

  throw new PlacementLayoutShiftError(
    `Placement "${observation.placementId}" layout shift check failed: ${observation.reason}`
  );
}
