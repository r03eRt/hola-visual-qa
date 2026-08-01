import { test, expect } from '@playwright/test';
import type { PlacementDefinition } from '../../src/placements/model.js';
import { classifyPlacement, isPlacementSatisfied, type PlacementSignals } from '../../src/placements/state-machine.js';
import {
  createPlacementEventsCollector,
  type PlacementEventSourceLike,
  type PlacementLifecycleEvent
} from '../../src/placements/events.js';
import {
  evaluateRender,
  renderOutcomeSignal,
  toRenderSignals,
  RENDER_OUTCOMES,
  type RenderOutcome
} from '../../src/placements/render.js';

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

/** Fake DI event source recording the registered handler. */
function makeFakeSource(): {
  source: PlacementEventSourceLike;
  emit: (event: PlacementLifecycleEvent) => void;
} {
  let handler: ((e: PlacementLifecycleEvent) => void) | null = null;
  const source: PlacementEventSourceLike = {
    on(event, h) {
      expect(event).toBe('placement');
      handler = h;
    }
  };
  return {
    source,
    emit(event: PlacementLifecycleEvent) {
      handler?.(event);
    }
  };
}

test.describe('renderOutcomeSignal / RENDER_OUTCOMES', () => {
  test('renderOutcomeSignal formats `${base}:${outcome}` for every outcome', () => {
    for (const outcome of RENDER_OUTCOMES) {
      expect(renderOutcomeSignal('ad-render', outcome)).toBe(`ad-render:${outcome}`);
    }
  });

  test('RENDER_OUTCOMES is in severity precedence order', () => {
    expect(RENDER_OUTCOMES).toEqual(['provider_error', 'timeout', 'empty', 'rendered']);
  });
});

test.describe('evaluateRender', () => {
  for (const outcome of RENDER_OUTCOMES) {
    test(`single outcome observed -> renderOutcome:${outcome}, counts[${outcome}]>=1`, () => {
      const { source, emit } = makeFakeSource();
      const collector = createPlacementEventsCollector(source);
      const definition = baseDefinition({ events: { render: 'ad-render' } });

      emit({ placementId: definition.id, signal: renderOutcomeSignal('ad-render', outcome) });

      const observation = evaluateRender(definition, collector);
      expect(observation.renderOutcome).toBe(outcome);
      expect(observation.counts[outcome]).toBeGreaterThanOrEqual(1);
      expect(observation.renderSignal).toBe('ad-render');
    });
  }

  test('precedence: provider_error AND rendered present -> provider_error, but counts.rendered still reflects it', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { render: 'ad-render' } });

    emit({ placementId: definition.id, signal: renderOutcomeSignal('ad-render', 'rendered') });
    emit({ placementId: definition.id, signal: renderOutcomeSignal('ad-render', 'provider_error') });

    const observation = evaluateRender(definition, collector);
    expect(observation.renderOutcome).toBe('provider_error');
    expect(observation.counts.rendered).toBe(1);
    expect(observation.counts.provider_error).toBe(1);
  });

  test('base configured but nothing observed -> undefined + all-zero counts', () => {
    const { source } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { render: 'ad-render' } });

    const observation = evaluateRender(definition, collector);
    expect(observation).toEqual({
      placementId: definition.id,
      renderSignal: 'ad-render',
      renderOutcome: undefined,
      counts: { rendered: 0, empty: 0, provider_error: 0, timeout: 0 }
    });
  });

  test('no events/events.render configured -> undefined, renderSignal:null, all-zero counts', () => {
    const { source } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition();

    const observation = evaluateRender(definition, collector);
    expect(observation).toEqual({
      placementId: definition.id,
      renderSignal: null,
      renderOutcome: undefined,
      counts: { rendered: 0, empty: 0, provider_error: 0, timeout: 0 }
    });
  });

  test('negative: bare base signal (no :outcome) does not count', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { render: 'ad-render' } });

    emit({ placementId: definition.id, signal: 'ad-render' });

    const observation = evaluateRender(definition, collector);
    expect(observation.renderOutcome).toBeUndefined();
    expect(observation.counts).toEqual({ rendered: 0, empty: 0, provider_error: 0, timeout: 0 });
  });

  test('negative: a different placement id does not count', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { render: 'ad-render' } });

    emit({ placementId: 'other-placement', signal: renderOutcomeSignal('ad-render', 'rendered') });

    const observation = evaluateRender(definition, collector);
    expect(observation.renderOutcome).toBeUndefined();
    expect(observation.counts).toEqual({ rendered: 0, empty: 0, provider_error: 0, timeout: 0 });
  });
});

test.describe('classifyPlacement integration with toRenderSignals', () => {
  const readySignals: Pick<PlacementSignals, 'applicable' | 'containerFound' | 'requestObserved'> = {
    applicable: true,
    containerFound: true,
    requestObserved: true
  };

  const outcomeToState: Record<RenderOutcome, string> = {
    rendered: 'rendered',
    empty: 'empty',
    provider_error: 'provider_error',
    timeout: 'timeout'
  };

  for (const outcome of RENDER_OUTCOMES) {
    test(`renderOutcome:${outcome} -> classifyPlacement state:${outcomeToState[outcome]}`, () => {
      const { source, emit } = makeFakeSource();
      const collector = createPlacementEventsCollector(source);
      const definition = baseDefinition({ events: { render: 'ad-render' } });

      emit({ placementId: definition.id, signal: renderOutcomeSignal('ad-render', outcome) });

      const observation = evaluateRender(definition, collector);
      const signals: PlacementSignals = { ...readySignals, ...toRenderSignals(observation) };
      const result = classifyPlacement(definition.id, signals);

      expect(result.state).toBe(outcomeToState[outcome]);
      expect(result.terminal).toBe(true);
    });
  }

  test('renderOutcome undefined -> requested (non-terminal)', () => {
    const { source } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { render: 'ad-render' } });

    const observation = evaluateRender(definition, collector);
    const signals: PlacementSignals = { ...readySignals, ...toRenderSignals(observation) };
    const result = classifyPlacement(definition.id, signals);

    expect(result.state).toBe('requested');
    expect(result.terminal).toBe(false);
  });

  test('isPlacementSatisfied agrees: rendered -> true', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { render: 'ad-render' } });
    emit({ placementId: definition.id, signal: renderOutcomeSignal('ad-render', 'rendered') });

    const observation = evaluateRender(definition, collector);
    const signals: PlacementSignals = { ...readySignals, ...toRenderSignals(observation) };
    const result = classifyPlacement(definition.id, signals);

    expect(isPlacementSatisfied(result, definition)).toBe(true);
  });

  test('isPlacementSatisfied agrees: empty -> expectedEmpty true/false', () => {
    for (const expectedEmpty of [true, false]) {
      const { source, emit } = makeFakeSource();
      const collector = createPlacementEventsCollector(source);
      const definition = baseDefinition({ events: { render: 'ad-render' }, expectedEmpty });
      emit({ placementId: definition.id, signal: renderOutcomeSignal('ad-render', 'empty') });

      const observation = evaluateRender(definition, collector);
      const signals: PlacementSignals = { ...readySignals, ...toRenderSignals(observation) };
      const result = classifyPlacement(definition.id, signals);

      expect(isPlacementSatisfied(result, definition)).toBe(expectedEmpty);
    }
  });

  test('isPlacementSatisfied agrees: provider_error/timeout -> false', () => {
    for (const outcome of ['provider_error', 'timeout'] as const) {
      const { source, emit } = makeFakeSource();
      const collector = createPlacementEventsCollector(source);
      const definition = baseDefinition({ events: { render: 'ad-render' } });
      emit({ placementId: definition.id, signal: renderOutcomeSignal('ad-render', outcome) });

      const observation = evaluateRender(definition, collector);
      const signals: PlacementSignals = { ...readySignals, ...toRenderSignals(observation) };
      const result = classifyPlacement(definition.id, signals);

      expect(isPlacementSatisfied(result, definition)).toBe(false);
    }
  });
});

test.describe('toRenderSignals', () => {
  test('projects the renderOutcome shape', () => {
    const observation = evaluateRender(baseDefinition({ events: { render: 'ad-render' } }), createPlacementEventsCollector(makeFakeSource().source));
    expect(toRenderSignals(observation)).toEqual({ renderOutcome: undefined });
  });
});

test.describe('privacy', () => {
  test('no RenderObservation field carries a URL/header/body/payload', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { render: 'ad-render' } });

    const eventWithUrl: PlacementLifecycleEvent & { url: string } = {
      placementId: definition.id,
      signal: renderOutcomeSignal('ad-render', 'rendered'),
      url: 'https://vendor.example.com/secret?token=abc'
    };
    emit(eventWithUrl);

    const observation = evaluateRender(definition, collector);
    const serializedObservation = JSON.stringify(observation);

    expect(serializedObservation).not.toMatch(/https?:\/\//);
    expect(serializedObservation).not.toContain('token');
  });
});
