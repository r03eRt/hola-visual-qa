import { test, expect } from '@playwright/test';
import type { PlacementDefinition } from '../../src/placements/model.js';
import { classifyPlacement } from '../../src/placements/state-machine.js';
import {
  readContainerState,
  evaluateContainer,
  assertContainer,
  toContainerSignals,
  PlacementContainerError,
  type PlacementContainerPageLike,
  type PlacementLocatorLike,
  type PlacementBoundingBox,
  type RawContainerState,
  type ContainerObservation
} from '../../src/placements/container.js';

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
  visible?: boolean;
  boundingBox?: PlacementBoundingBox | null;
}

interface FakeLocatorCounters {
  count: number;
  isVisible: number;
  boundingBox: number;
}

function makeFakePage(
  script: FakeLocatorScript,
  counters: FakeLocatorCounters
): PlacementContainerPageLike {
  const locator: PlacementLocatorLike = {
    async count(): Promise<number> {
      counters.count += 1;
      return script.count;
    },
    first(): PlacementLocatorLike {
      return locator;
    },
    async isVisible(): Promise<boolean> {
      counters.isVisible += 1;
      return script.visible ?? false;
    },
    async boundingBox(): Promise<PlacementBoundingBox | null> {
      counters.boundingBox += 1;
      return script.boundingBox ?? null;
    }
  };

  return {
    locator(): PlacementLocatorLike {
      return locator;
    }
  };
}

test.describe('readContainerState', () => {
  test('short-circuits to present:false/visible:false/box:null without calling isVisible/boundingBox when count is 0', async () => {
    const counters: FakeLocatorCounters = { count: 0, isVisible: 0, boundingBox: 0 };
    const page = makeFakePage({ count: 0 }, counters);

    const raw = await readContainerState(page, baseDefinition());

    expect(raw).toEqual({ present: false, visible: false, box: null });
    expect(counters.count).toBe(1);
    expect(counters.isVisible).toBe(0);
    expect(counters.boundingBox).toBe(0);
  });

  test('present path rounds the bounding box to integer width/height', async () => {
    const counters: FakeLocatorCounters = { count: 0, isVisible: 0, boundingBox: 0 };
    const page = makeFakePage(
      { count: 1, visible: true, boundingBox: { x: 0, y: 0, width: 727.6, height: 90.4 } },
      counters
    );

    const raw = await readContainerState(page, baseDefinition());

    expect(raw).toEqual({ present: true, visible: true, box: { width: 728, height: 90 } });
    expect(counters.isVisible).toBe(1);
    expect(counters.boundingBox).toBe(1);
  });

  test('a null boundingBox yields box:null when present', async () => {
    const counters: FakeLocatorCounters = { count: 0, isVisible: 0, boundingBox: 0 };
    const page = makeFakePage({ count: 1, visible: false, boundingBox: null }, counters);

    const raw = await readContainerState(page, baseDefinition());

    expect(raw).toEqual({ present: true, visible: false, box: null });
  });
});

test.describe('evaluateContainer — expectedVisible: true', () => {
  const definition = baseDefinition({
    allowedSizes: [
      { width: 728, height: 90 },
      { width: 970, height: 250 }
    ]
  });

  test('satisfied when present + visible + a size within tolerance matches', () => {
    const raw: RawContainerState = { present: true, visible: true, box: { width: 728, height: 90 } };
    const observation = evaluateContainer(definition, 'desktop', raw);

    expect(observation.satisfied).toBe(true);
    expect(observation.reason).toBeUndefined();
    expect(observation.matchedSize).toEqual({ width: 728, height: 90 });
    expect(observation.sizeAllowed).toBe(true);
    expect(observation.containerFound).toBe(true);
    expect(observation.applicableOnDevice).toBe(true);
  });

  test('matchedSize is the first in-order match when multiple allowedSizes match', () => {
    const multiMatchDefinition = baseDefinition({
      allowedSizes: [
        { width: 300, height: 250 },
        { width: 300, height: 251 }
      ]
    });
    const raw: RawContainerState = { present: true, visible: true, box: { width: 300, height: 250 } };
    const observation = evaluateContainer(multiMatchDefinition, 'desktop', raw);

    expect(observation.matchedSize).toEqual({ width: 300, height: 250 });
  });

  test('a box off by exactly the tolerance matches', () => {
    const raw: RawContainerState = { present: true, visible: true, box: { width: 729, height: 91 } };
    const observation = evaluateContainer(definition, 'desktop', raw, { tolerancePx: 1 });

    expect(observation.sizeAllowed).toBe(true);
    expect(observation.matchedSize).toEqual({ width: 728, height: 90 });
    expect(observation.satisfied).toBe(true);
  });

  test('a box off by more than the tolerance does not match', () => {
    const raw: RawContainerState = { present: true, visible: true, box: { width: 730, height: 92 } };
    const observation = evaluateContainer(definition, 'desktop', raw, { tolerancePx: 1 });

    expect(observation.sizeAllowed).toBe(false);
    expect(observation.matchedSize).toBeNull();
    expect(observation.satisfied).toBe(false);
    expect(observation.reason).toBe('size not allowed (observed 730x92)');
  });

  test('reason is "container missing" when not present', () => {
    const raw: RawContainerState = { present: false, visible: false, box: null };
    const observation = evaluateContainer(definition, 'desktop', raw);

    expect(observation.satisfied).toBe(false);
    expect(observation.reason).toBe('container missing');
    expect(observation.containerFound).toBe(false);
  });

  test('reason is "container not visible" when present but not visible', () => {
    const raw: RawContainerState = { present: true, visible: false, box: { width: 728, height: 90 } };
    const observation = evaluateContainer(definition, 'desktop', raw);

    expect(observation.satisfied).toBe(false);
    expect(observation.reason).toBe('container not visible');
    expect(observation.containerFound).toBe(false);
  });

  test('reason names an observed size mismatch when box is measurable', () => {
    const raw: RawContainerState = { present: true, visible: true, box: { width: 100, height: 100 } };
    const observation = evaluateContainer(definition, 'desktop', raw);

    expect(observation.satisfied).toBe(false);
    expect(observation.reason).toBe('size not allowed (observed 100x100)');
  });

  test('reason is "size not allowed (not measurable)" when box is null but present+visible', () => {
    const raw: RawContainerState = { present: true, visible: true, box: null };
    const observation = evaluateContainer(definition, 'desktop', raw);

    expect(observation.satisfied).toBe(false);
    expect(observation.reason).toBe('size not allowed (not measurable)');
    expect(observation.sizeAllowed).toBe(false);
    expect(observation.matchedSize).toBeNull();
  });
});

test.describe('evaluateContainer — expectedVisible: false', () => {
  const definition = baseDefinition({ visibility: { desktop: true, mobile: false } });

  test('satisfied when not visible (absent)', () => {
    const raw: RawContainerState = { present: false, visible: false, box: null };
    const observation = evaluateContainer(definition, 'mobile', raw);

    expect(observation.applicableOnDevice).toBe(false);
    expect(observation.satisfied).toBe(true);
    expect(observation.reason).toBeUndefined();
  });

  test('satisfied when present but hidden', () => {
    const raw: RawContainerState = { present: true, visible: false, box: { width: 728, height: 90 } };
    const observation = evaluateContainer(definition, 'mobile', raw);

    expect(observation.satisfied).toBe(true);
    expect(observation.reason).toBeUndefined();
  });

  test('not satisfied when visible, with "unexpectedly visible" reason, regardless of sizeAllowed', () => {
    const raw: RawContainerState = { present: true, visible: true, box: { width: 728, height: 90 } };
    const observation = evaluateContainer(definition, 'mobile', raw);

    expect(observation.satisfied).toBe(false);
    expect(observation.reason).toBe('unexpectedly visible on mobile');
    // sizeAllowed is still computed for diagnosis...
    expect(observation.sizeAllowed).toBe(true);

    const rawMismatchedSize: RawContainerState = { present: true, visible: true, box: { width: 1, height: 1 } };
    const observationMismatched = evaluateContainer(definition, 'mobile', rawMismatchedSize);
    // ...but does not change satisfied either way.
    expect(observationMismatched.satisfied).toBe(false);
    expect(observationMismatched.sizeAllowed).toBe(false);
  });
});

test.describe('classifyPlacement integration via container signals', () => {
  const definition = baseDefinition();

  test('present + visible -> container_ready', () => {
    const raw: RawContainerState = { present: true, visible: true, box: { width: 728, height: 90 } };
    const observation = evaluateContainer(definition, 'desktop', raw);
    const signals = toContainerSignals(observation);

    expect(signals).toEqual({ applicable: true, containerFound: true });

    const classified = classifyPlacement(definition.id, signals);
    expect(classified.state).toBe('container_ready');
    expect(classified.terminal).toBe(false);
  });

  test('missing -> container_missing', () => {
    const raw: RawContainerState = { present: false, visible: false, box: null };
    const observation = evaluateContainer(definition, 'desktop', raw);
    const signals = toContainerSignals(observation);

    expect(signals).toEqual({ applicable: true, containerFound: false });

    const classified = classifyPlacement(definition.id, signals);
    expect(classified.state).toBe('container_missing');
    expect(classified.terminal).toBe(true);
  });

  test('not expected on device (applicable false) -> skipped', () => {
    const raw: RawContainerState = { present: false, visible: false, box: null };
    const observation = evaluateContainer(definition, 'mobile', raw);
    const signals = toContainerSignals(observation);

    expect(signals).toEqual({ applicable: false, containerFound: false });

    const classified = classifyPlacement(definition.id, signals);
    expect(classified.state).toBe('skipped');
    expect(classified.terminal).toBe(true);
  });
});

test.describe('assertContainer', () => {
  test('does not throw when satisfied', () => {
    const observation: ContainerObservation = {
      placementId: 'homepage-leaderboard',
      device: 'desktop',
      expectedVisible: true,
      present: true,
      visible: true,
      size: { width: 728, height: 90 },
      matchedSize: { width: 728, height: 90 },
      sizeAllowed: true,
      containerFound: true,
      applicableOnDevice: true,
      satisfied: true
    };

    expect(() => assertContainer(observation)).not.toThrow();
  });

  test('throws a normalized PlacementContainerError with a report-safe message when not satisfied', () => {
    const observation: ContainerObservation = {
      placementId: 'homepage-leaderboard',
      device: 'desktop',
      expectedVisible: true,
      present: false,
      visible: false,
      size: null,
      matchedSize: null,
      sizeAllowed: false,
      containerFound: false,
      applicableOnDevice: true,
      satisfied: false,
      reason: 'container missing'
    };

    let thrown: unknown;
    try {
      assertContainer(observation);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PlacementContainerError);
    const error = thrown as PlacementContainerError;
    expect(error.message).toBe('Placement "homepage-leaderboard" container check failed: container missing');
    expect(error.normalized.category).toBe('placement_failure');
    expect(error.normalized.phase).toBe('assertion');
  });

  test('never leaks the raw selector value in the observation or error message', () => {
    const definition = baseDefinition({ containerSelector: '#SECRET-SELECTOR-xyz' });
    const raw: RawContainerState = { present: false, visible: false, box: null };
    const observation = evaluateContainer(definition, 'desktop', raw);

    expect(JSON.stringify(observation)).not.toContain('#SECRET-SELECTOR-xyz');

    let thrown: unknown;
    try {
      assertContainer(observation);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PlacementContainerError);
    const error = thrown as PlacementContainerError;
    expect(error.message).not.toContain('#SECRET-SELECTOR-xyz');
    expect(error.normalized.message).not.toContain('#SECRET-SELECTOR-xyz');
  });
});
