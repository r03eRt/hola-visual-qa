import { test, expect } from '@playwright/test';
import {
  assertPlacementResolved,
  PlacementResolutionError,
  classifyPlacement,
  parsePlacementDefinition,
  type PlacementDefinition,
  type PlacementSignals
} from '../../src/placements/index.js';

function def(overrides: Partial<Parameters<typeof parsePlacementDefinition>[0] & object> = {}): PlacementDefinition {
  return parsePlacementDefinition({
    id: 'top-banner',
    pages: ['/'],
    containerSelector: '#top-ad',
    allowedSizes: [{ width: 970, height: 250 }],
    ...overrides
  });
}

const base: PlacementSignals = { applicable: true, containerFound: true, requestObserved: true };

test.describe('assertPlacementResolved', () => {
  test('does not throw for a satisfied terminal (rendered)', () => {
    const obs = classifyPlacement('top-banner', { ...base, renderOutcome: 'rendered' });
    expect(() => assertPlacementResolved(def(), obs)).not.toThrow();
  });

  test('does not throw for a skipped placement', () => {
    const obs = classifyPlacement('top-banner', { applicable: false });
    expect(() => assertPlacementResolved(def(), obs)).not.toThrow();
  });

  test('does not throw for a non-terminal (insufficient-evidence) state', () => {
    const obs = classifyPlacement('top-banner', { ...base, renderOutcome: undefined });
    expect(obs.terminal).toBe(false);
    expect(() => assertPlacementResolved(def(), obs)).not.toThrow();
  });

  test('throws for request_missing', () => {
    const obs = classifyPlacement('top-banner', { applicable: true, containerFound: true, requestObserved: false });
    expect(() => assertPlacementResolved(def(), obs)).toThrow(PlacementResolutionError);
  });

  test('throws for provider_error and timeout', () => {
    for (const outcome of ['provider_error', 'timeout'] as const) {
      const obs = classifyPlacement('top-banner', { ...base, renderOutcome: outcome });
      expect(() => assertPlacementResolved(def(), obs)).toThrow(PlacementResolutionError);
    }
  });

  test('empty fails unless the definition declares expectedEmpty', () => {
    const obs = classifyPlacement('top-banner', { ...base, renderOutcome: 'empty' });
    expect(() => assertPlacementResolved(def(), obs)).toThrow(PlacementResolutionError);
    expect(() => assertPlacementResolved(def({ expectedEmpty: true }), obs)).not.toThrow();
  });

  test('carries a normalized placement_failure/assertion error naming only id and state/stage', () => {
    const obs = classifyPlacement('secret-looking-id', { applicable: true, containerFound: true, requestObserved: false });
    try {
      assertPlacementResolved(def({ id: 'secret-looking-id' }), obs);
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PlacementResolutionError);
      const err = error as PlacementResolutionError;
      expect(err.normalized.category).toBe('placement_failure');
      expect(err.normalized.phase).toBe('assertion');
      expect(err.message).toContain('secret-looking-id');
      expect(err.message).toContain('request_missing');
      expect(err.message).not.toContain('#top-ad');
    }
  });
});
