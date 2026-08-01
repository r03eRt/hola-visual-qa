import { test, expect } from '@playwright/test';
import {
  PlacementDefinitionSchema,
  type PlacementDefinition,
  type PlacementObservation
} from '../../src/placements/model.js';
import {
  classifyPlacement,
  isPlacementSatisfied,
  parsePlacementDefinitionOrThrow,
  PlacementDefinitionError,
  TERMINAL_PLACEMENT_STATES,
  type PlacementSignals
} from '../../src/placements/state-machine.js';

function validDefinitionInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 'homepage-leaderboard',
    pages: ['/'],
    containerSelector: '[data-testid="ad-leaderboard"]',
    allowedSizes: [{ width: 728, height: 90 }],
    visibility: { desktop: true, mobile: false },
    events: { request: 'ad:request', render: 'ad:render' },
    timeoutMs: 5000,
    expectedEmpty: true,
    protectedRegions: ['[data-testid="header"]'],
    screenshotTarget: 'ad-leaderboard',
    ...overrides
  };
}

function assertTerminalConsistency(observation: PlacementObservation): void {
  expect(observation.terminal).toBe(TERMINAL_PLACEMENT_STATES.has(observation.state));
}

test.describe('PlacementDefinitionSchema', () => {
  test('parses a complete definition as given', () => {
    const parsed = PlacementDefinitionSchema.parse(validDefinitionInput());
    expect(parsed).toEqual(validDefinitionInput());
  });

  test('applies documented defaults for a minimal definition', () => {
    const parsed = PlacementDefinitionSchema.parse({
      id: 'homepage-leaderboard',
      pages: ['/'],
      containerSelector: '[data-testid="ad-leaderboard"]',
      allowedSizes: [{ width: 728, height: 90 }]
    });

    expect(parsed.visibility).toEqual({ desktop: true, mobile: true });
    expect(parsed.timeoutMs).toBe(10_000);
    expect(parsed.expectedEmpty).toBe(false);
    expect(parsed.protectedRegions).toEqual([]);
    expect(parsed.events).toBeUndefined();
    expect(parsed.screenshotTarget).toBeUndefined();
  });

  test('rejects an unknown key', () => {
    expect(() => PlacementDefinitionSchema.parse(validDefinitionInput({ extra: 'nope' }))).toThrow();
  });

  test('rejects an empty id', () => {
    expect(() => PlacementDefinitionSchema.parse(validDefinitionInput({ id: '' }))).toThrow();
  });

  test('rejects an empty containerSelector', () => {
    expect(() => PlacementDefinitionSchema.parse(validDefinitionInput({ containerSelector: '' }))).toThrow();
  });

  test('rejects empty allowedSizes', () => {
    expect(() => PlacementDefinitionSchema.parse(validDefinitionInput({ allowedSizes: [] }))).toThrow();
  });

  test('rejects a secret-like key', () => {
    expect(() => PlacementDefinitionSchema.parse(validDefinitionInput({ token: 'shh' }))).toThrow();
  });
});

test.describe('classifyPlacement', () => {
  const placementId = 'homepage-leaderboard';

  test('not applicable -> skipped (terminal)', () => {
    const observation = classifyPlacement(placementId, { applicable: false });
    expect(observation).toEqual({ placementId, state: 'skipped', stage: 'applicability', terminal: true });
    assertTerminalConsistency(observation);
  });

  test('container explicitly missing -> container_missing (terminal)', () => {
    const observation = classifyPlacement(placementId, { applicable: true, containerFound: false });
    expect(observation).toEqual({
      placementId,
      state: 'container_missing',
      stage: 'container',
      terminal: true
    });
    assertTerminalConsistency(observation);
  });

  test('container not yet observed -> container_ready/container (non-terminal boundary)', () => {
    const observation = classifyPlacement(placementId, { applicable: true });
    expect(observation).toEqual({
      placementId,
      state: 'container_ready',
      stage: 'container',
      terminal: false
    });
    assertTerminalConsistency(observation);
  });

  test('request explicitly missing after container found -> request_missing (terminal)', () => {
    const observation = classifyPlacement(placementId, {
      applicable: true,
      containerFound: true,
      requestObserved: false
    });
    expect(observation).toEqual({
      placementId,
      state: 'request_missing',
      stage: 'request',
      terminal: true
    });
    assertTerminalConsistency(observation);
  });

  test('request not yet observed after container found -> container_ready/request (non-terminal boundary)', () => {
    const observation = classifyPlacement(placementId, { applicable: true, containerFound: true });
    expect(observation).toEqual({
      placementId,
      state: 'container_ready',
      stage: 'request',
      terminal: false
    });
    assertTerminalConsistency(observation);
  });

  test('render not yet observed after request observed -> requested/render (non-terminal boundary)', () => {
    const observation = classifyPlacement(placementId, {
      applicable: true,
      containerFound: true,
      requestObserved: true
    });
    expect(observation).toEqual({ placementId, state: 'requested', stage: 'render', terminal: false });
    assertTerminalConsistency(observation);
  });

  test('renderOutcome rendered -> rendered (terminal)', () => {
    const observation = classifyPlacement(placementId, {
      applicable: true,
      containerFound: true,
      requestObserved: true,
      renderOutcome: 'rendered'
    });
    expect(observation).toEqual({ placementId, state: 'rendered', stage: 'render', terminal: true });
    assertTerminalConsistency(observation);
  });

  test('renderOutcome empty -> empty (terminal)', () => {
    const observation = classifyPlacement(placementId, {
      applicable: true,
      containerFound: true,
      requestObserved: true,
      renderOutcome: 'empty'
    });
    expect(observation).toEqual({ placementId, state: 'empty', stage: 'render', terminal: true });
    assertTerminalConsistency(observation);
  });

  test('renderOutcome provider_error -> provider_error (terminal)', () => {
    const observation = classifyPlacement(placementId, {
      applicable: true,
      containerFound: true,
      requestObserved: true,
      renderOutcome: 'provider_error'
    });
    expect(observation).toEqual({ placementId, state: 'provider_error', stage: 'render', terminal: true });
    assertTerminalConsistency(observation);
  });

  test('renderOutcome timeout -> timeout (terminal)', () => {
    const observation = classifyPlacement(placementId, {
      applicable: true,
      containerFound: true,
      requestObserved: true,
      renderOutcome: 'timeout'
    });
    expect(observation).toEqual({ placementId, state: 'timeout', stage: 'render', terminal: true });
    assertTerminalConsistency(observation);
  });

  test('contradictory input (containerFound:false, requestObserved:true) -> container_missing (earlier gate wins)', () => {
    const signals: PlacementSignals = { applicable: true, containerFound: false, requestObserved: true };
    const observation = classifyPlacement(placementId, signals);
    expect(observation).toEqual({
      placementId,
      state: 'container_missing',
      stage: 'container',
      terminal: true
    });
    assertTerminalConsistency(observation);
  });
});

test('TERMINAL_PLACEMENT_STATES contains exactly the terminal states', () => {
  expect(new Set(TERMINAL_PLACEMENT_STATES)).toEqual(
    new Set(['skipped', 'container_missing', 'request_missing', 'rendered', 'empty', 'provider_error', 'timeout'])
  );
});

test.describe('isPlacementSatisfied', () => {
  const placementId = 'homepage-leaderboard';

  function definitionWith(expectedEmpty: boolean): PlacementDefinition {
    return PlacementDefinitionSchema.parse(validDefinitionInput({ expectedEmpty }));
  }

  function observationFor(state: PlacementObservation['state'], stage: PlacementObservation['stage'], terminal: boolean): PlacementObservation {
    return { placementId, state, stage, terminal };
  }

  test('skipped is satisfied', () => {
    expect(isPlacementSatisfied(observationFor('skipped', 'applicability', true), definitionWith(false))).toBe(true);
  });

  test('rendered is satisfied', () => {
    expect(isPlacementSatisfied(observationFor('rendered', 'render', true), definitionWith(false))).toBe(true);
  });

  test('empty is satisfied when expectedEmpty is true', () => {
    expect(isPlacementSatisfied(observationFor('empty', 'render', true), definitionWith(true))).toBe(true);
  });

  test('empty is NOT satisfied when expectedEmpty is false', () => {
    expect(isPlacementSatisfied(observationFor('empty', 'render', true), definitionWith(false))).toBe(false);
  });

  test('container_missing is not satisfied', () => {
    expect(isPlacementSatisfied(observationFor('container_missing', 'container', true), definitionWith(false))).toBe(
      false
    );
  });

  test('request_missing is not satisfied', () => {
    expect(isPlacementSatisfied(observationFor('request_missing', 'request', true), definitionWith(false))).toBe(
      false
    );
  });

  test('provider_error is not satisfied', () => {
    expect(isPlacementSatisfied(observationFor('provider_error', 'render', true), definitionWith(false))).toBe(false);
  });

  test('timeout is not satisfied', () => {
    expect(isPlacementSatisfied(observationFor('timeout', 'render', true), definitionWith(false))).toBe(false);
  });

  test('non-terminal container_ready is not satisfied', () => {
    expect(
      isPlacementSatisfied(observationFor('container_ready', 'container', false), definitionWith(false))
    ).toBe(false);
  });

  test('non-terminal requested is not satisfied', () => {
    expect(isPlacementSatisfied(observationFor('requested', 'render', false), definitionWith(false))).toBe(false);
  });
});

test.describe('parsePlacementDefinitionOrThrow', () => {
  test('parses valid input like PlacementDefinitionSchema.parse', () => {
    const parsed = parsePlacementDefinitionOrThrow(validDefinitionInput());
    expect(parsed).toEqual(validDefinitionInput());
  });

  test('throws a normalized configuration_error/planning PlacementDefinitionError naming field paths, never values', () => {
    const secretValue = 'sk-super-secret-do-not-leak-1234567890';
    let thrown: unknown;
    try {
      parsePlacementDefinitionOrThrow(
        validDefinitionInput({ id: '', containerSelector: '', token: secretValue })
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PlacementDefinitionError);
    const error = thrown as PlacementDefinitionError;
    expect(error.normalized.category).toBe('configuration_error');
    expect(error.normalized.phase).toBe('planning');
    expect(error.message).toContain('id');
    expect(error.message).toContain('containerSelector');
    expect(error.message).not.toContain(secretValue);
    expect(error.normalized.message).not.toContain(secretValue);
  });
});
