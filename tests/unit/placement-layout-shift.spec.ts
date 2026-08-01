import { test, expect } from '@playwright/test';
import type { PlacementDefinition } from '../../src/placements/model.js';
import {
  readLayoutSnapshot,
  evaluateLayoutShift,
  assertLayoutShift,
  PlacementLayoutShiftError,
  type RawLayoutSnapshot
} from '../../src/placements/layout-shift.js';
import type { PlacementBoundingBox, PlacementContainerPageLike, PlacementLocatorLike } from '../../src/placements/container.js';

function baseDefinition(overrides: Partial<PlacementDefinition> = {}): PlacementDefinition {
  return {
    id: 'homepage-leaderboard',
    pages: ['/'],
    containerSelector: '[data-testid="ad-leaderboard"]',
    allowedSizes: [{ width: 728, height: 90 }],
    visibility: { desktop: true, mobile: false },
    timeoutMs: 10_000,
    expectedEmpty: false,
    protectedRegions: [],
    ...overrides
  };
}

interface FakeLocatorScript {
  count: number;
  boundingBox?: PlacementBoundingBox | null;
}

interface FakeCounters {
  boundingBoxCalls: number;
}

function makeFakePage(scriptBySelector: Record<string, FakeLocatorScript>, counters: FakeCounters): PlacementContainerPageLike {
  return {
    locator(selector: string): PlacementLocatorLike {
      const script = scriptBySelector[selector] ?? { count: 0 };
      const locator: PlacementLocatorLike = {
        async count(): Promise<number> {
          return script.count;
        },
        first(): PlacementLocatorLike {
          return locator;
        },
        async isVisible(): Promise<boolean> {
          return true;
        },
        async boundingBox(): Promise<PlacementBoundingBox | null> {
          counters.boundingBoxCalls += 1;
          return script.boundingBox ?? null;
        }
      };
      return locator;
    }
  };
}

test.describe('readLayoutSnapshot', () => {
  test('absent container returns null without calling boundingBox', async () => {
    const counters: FakeCounters = { boundingBoxCalls: 0 };
    const page = makeFakePage({}, counters);

    const snapshot = await readLayoutSnapshot(page, baseDefinition());

    expect(snapshot.container).toBeNull();
    expect(counters.boundingBoxCalls).toBe(0);
  });

  test('present container + protected regions (one absent) preserve order and round to integers', async () => {
    const counters: FakeCounters = { boundingBoxCalls: 0 };
    const definition = baseDefinition({
      protectedRegions: ['[data-testid="region-a"]', '[data-testid="region-b"]']
    });
    const page = makeFakePage(
      {
        '[data-testid="ad-leaderboard"]': { count: 1, boundingBox: { x: 10.4, y: 20.6, width: 728.2, height: 90.7 } },
        '[data-testid="region-a"]': { count: 1, boundingBox: { x: 1, y: 2, width: 3, height: 4 } },
        '[data-testid="region-b"]': { count: 0 }
      },
      counters
    );

    const snapshot = await readLayoutSnapshot(page, definition);

    expect(snapshot.container).toEqual({ x: 10, y: 21, width: 728, height: 91 });
    expect(snapshot.protectedRegions).toEqual([{ x: 1, y: 2, width: 3, height: 4 }, null]);
    // Only two boundingBox calls: container + region-a. region-b is absent (count 0).
    expect(counters.boundingBoxCalls).toBe(2);
  });
});

test.describe('evaluateLayoutShift', () => {
  test('identical before/after -> none, max 0, measurable, satisfied', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const box: PlacementBoundingBox = { x: 10, y: 20, width: 100, height: 50 };
    const snapshot: RawLayoutSnapshot = { container: box, protectedRegions: [box] };

    const observation = evaluateLayoutShift(definition, snapshot, snapshot);

    expect(observation.level).toBe('none');
    expect(observation.maxDisplacementPx).toBe(0);
    expect(observation.measurable).toBe(true);
    expect(observation.satisfied).toBe(true);
    expect(observation.reason).toBeUndefined();
  });

  test('vertical push of a protected region by 10px, tolerance 2 -> exceeded', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = {
      container: { x: 0, y: 0, width: 10, height: 10 },
      protectedRegions: [{ x: 5, y: 5, width: 10, height: 10 }]
    };
    const after: RawLayoutSnapshot = {
      container: { x: 0, y: 0, width: 10, height: 10 },
      protectedRegions: [{ x: 5, y: 15, width: 10, height: 10 }]
    };

    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });

    expect(observation.level).toBe('exceeded');
    expect(observation.maxDisplacementPx).toBe(10);
    expect(observation.reason).toBe('layout shift 10px exceeds tolerance 2px');
    expect(observation.satisfied).toBe(false);
  });

  test('diagonal move (3,4) -> displacement 5', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = {
      container: null,
      protectedRegions: [{ x: 0, y: 0, width: 10, height: 10 }]
    };
    const after: RawLayoutSnapshot = {
      container: null,
      protectedRegions: [{ x: 3, y: 4, width: 10, height: 10 }]
    };

    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });

    expect(observation.regions[1]?.displacementPx).toBe(5);
    expect(observation.maxDisplacementPx).toBe(5);
    expect(observation.level).toBe('exceeded');
  });

  test('boundary: max displacement == tolerancePx -> within_tolerance', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = {
      container: null,
      protectedRegions: [{ x: 0, y: 0, width: 10, height: 10 }]
    };
    const after: RawLayoutSnapshot = {
      container: null,
      protectedRegions: [{ x: 0, y: 2, width: 10, height: 10 }]
    };

    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });

    expect(observation.maxDisplacementPx).toBe(2);
    expect(observation.level).toBe('within_tolerance');
    expect(observation.satisfied).toBe(true);
  });

  test('boundary + 1: tolerancePx + 1 -> exceeded', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = {
      container: null,
      protectedRegions: [{ x: 0, y: 0, width: 10, height: 10 }]
    };
    const after: RawLayoutSnapshot = {
      container: null,
      protectedRegions: [{ x: 0, y: 3, width: 10, height: 10 }]
    };

    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });

    expect(observation.maxDisplacementPx).toBe(3);
    expect(observation.level).toBe('exceeded');
  });

  test('container moved but regions still -> max across all regions is used', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = {
      container: { x: 0, y: 0, width: 10, height: 10 },
      protectedRegions: [{ x: 5, y: 5, width: 10, height: 10 }]
    };
    const after: RawLayoutSnapshot = {
      container: { x: 0, y: 7, width: 10, height: 10 },
      protectedRegions: [{ x: 5, y: 5, width: 10, height: 10 }]
    };

    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });

    expect(observation.regions[0]?.displacementPx).toBe(7);
    expect(observation.regions[1]?.displacementPx).toBe(0);
    expect(observation.maxDisplacementPx).toBe(7);
    expect(observation.level).toBe('exceeded');
  });

  test('region absent in after -> displacementPx null and excluded from max', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = {
      container: { x: 0, y: 0, width: 10, height: 10 },
      protectedRegions: [{ x: 5, y: 5, width: 10, height: 10 }]
    };
    const after: RawLayoutSnapshot = {
      container: { x: 0, y: 6, width: 10, height: 10 },
      protectedRegions: [null]
    };

    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });

    expect(observation.regions[1]?.displacementPx).toBeNull();
    expect(observation.maxDisplacementPx).toBe(6);
    expect(observation.measurable).toBe(true);
  });

  test('all regions unmeasurable -> measurable false, none, satisfied true', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = { container: null, protectedRegions: [null] };
    const after: RawLayoutSnapshot = { container: null, protectedRegions: [null] };

    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });

    expect(observation.measurable).toBe(false);
    expect(observation.level).toBe('none');
    expect(observation.satisfied).toBe(true);
    expect(observation.maxDisplacementPx).toBeNull();
  });

  test('empty protectedRegions + null container in both snapshots -> measurable false, none', () => {
    const definition = baseDefinition({ protectedRegions: [] });
    const before: RawLayoutSnapshot = { container: null, protectedRegions: [] };
    const after: RawLayoutSnapshot = { container: null, protectedRegions: [] };

    const observation = evaluateLayoutShift(definition, before, after);

    expect(observation.measurable).toBe(false);
    expect(observation.level).toBe('none');
  });

  test('default tolerancePx (omitted) is 2', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = { container: null, protectedRegions: [{ x: 0, y: 0, width: 1, height: 1 }] };
    const after: RawLayoutSnapshot = { container: null, protectedRegions: [{ x: 0, y: 2, width: 1, height: 1 }] };

    const observation = evaluateLayoutShift(definition, before, after);

    expect(observation.tolerancePx).toBe(2);
    expect(observation.level).toBe('within_tolerance');
  });

  test('negative tolerancePx is clamped to 0', () => {
    const definition = baseDefinition();
    const observation = evaluateLayoutShift(
      definition,
      { container: null, protectedRegions: [] },
      { container: null, protectedRegions: [] },
      { tolerancePx: -5 }
    );

    expect(observation.tolerancePx).toBe(0);
  });

  test('fractional tolerancePx is truncated', () => {
    const definition = baseDefinition();
    const observation = evaluateLayoutShift(
      definition,
      { container: null, protectedRegions: [] },
      { container: null, protectedRegions: [] },
      { tolerancePx: 2.9 }
    );

    expect(observation.tolerancePx).toBe(2);
  });
});

test.describe('assertLayoutShift', () => {
  test('throws PlacementLayoutShiftError with normalized category/phase on exceedance', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = { container: null, protectedRegions: [{ x: 0, y: 0, width: 1, height: 1 }] };
    const after: RawLayoutSnapshot = { container: null, protectedRegions: [{ x: 0, y: 10, width: 1, height: 1 }] };
    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });

    let thrown: unknown;
    try {
      assertLayoutShift(observation);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PlacementLayoutShiftError);
    const error = thrown as PlacementLayoutShiftError;
    expect(error.message).toBe('Placement "homepage-leaderboard" layout shift check failed: layout shift 10px exceeds tolerance 2px');
    expect(error.normalized.category).toBe('placement_failure');
    expect(error.normalized.phase).toBe('assertion');
  });

  test('does not throw when within tolerance', () => {
    const definition = baseDefinition({ protectedRegions: ['[data-testid="region-a"]'] });
    const before: RawLayoutSnapshot = { container: null, protectedRegions: [{ x: 0, y: 0, width: 1, height: 1 }] };
    const after: RawLayoutSnapshot = { container: null, protectedRegions: [{ x: 0, y: 1, width: 1, height: 1 }] };
    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });

    expect(() => assertLayoutShift(observation)).not.toThrow();
  });

  test('does not throw when level is none', () => {
    const definition = baseDefinition();
    const snapshot: RawLayoutSnapshot = { container: null, protectedRegions: [] };
    const observation = evaluateLayoutShift(definition, snapshot, snapshot);

    expect(() => assertLayoutShift(observation)).not.toThrow();
  });
});

test.describe('privacy', () => {
  test('observation JSON never contains the raw selector value or page content', () => {
    const definition = baseDefinition({
      containerSelector: '#SECRET-SELECTOR-xyz',
      protectedRegions: ['[data-secret="token=abc123"]']
    });
    const before: RawLayoutSnapshot = {
      container: { x: 0, y: 0, width: 10, height: 10 },
      protectedRegions: [{ x: 0, y: 0, width: 10, height: 10 }]
    };
    const after: RawLayoutSnapshot = {
      container: { x: 0, y: 5, width: 10, height: 10 },
      protectedRegions: [{ x: 0, y: 5, width: 10, height: 10 }]
    };

    const observation = evaluateLayoutShift(definition, before, after, { tolerancePx: 2 });
    const json = JSON.stringify(observation);

    expect(json).not.toContain('SECRET-SELECTOR-xyz');
    expect(json).not.toContain('token=abc123');
    expect(json).toContain('container');
    expect(json).toContain('protected[0]');
  });
});
