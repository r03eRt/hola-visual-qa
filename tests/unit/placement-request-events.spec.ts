import { test, expect } from '@playwright/test';
import type { PlacementDefinition } from '../../src/placements/model.js';
import { classifyPlacement, type PlacementSignals } from '../../src/placements/state-machine.js';
import {
  createPlacementEventsCollector,
  type PlacementEventSourceLike,
  type PlacementLifecycleEvent
} from '../../src/placements/events.js';
import { evaluateRequest, toRequestSignals } from '../../src/placements/request.js';

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

/** Fake DI event source recording the registered handler and registration count. */
function makeFakeSource(): {
  source: PlacementEventSourceLike;
  getRegistrations: () => number;
  emit: (event: PlacementLifecycleEvent) => void;
} {
  let handler: ((e: PlacementLifecycleEvent) => void) | null = null;
  let registrations = 0;
  const source: PlacementEventSourceLike = {
    on(event, h) {
      expect(event).toBe('placement');
      registrations += 1;
      handler = h;
    }
  };
  return {
    source,
    getRegistrations: () => registrations,
    emit(event: PlacementLifecycleEvent) {
      handler?.(event);
    }
  };
}

test.describe('createPlacementEventsCollector', () => {
  test('registers exactly one handler and accumulates in insertion order', () => {
    const { source, emit, getRegistrations } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);

    expect(getRegistrations()).toBe(1);

    emit({ placementId: 'a', signal: 'request' });
    emit({ placementId: 'b', signal: 'render' });
    emit({ placementId: 'a', signal: 'request' });

    const snap = collector.snapshot();
    expect(snap.events).toEqual([
      { placementId: 'a', signal: 'request' },
      { placementId: 'b', signal: 'render' },
      { placementId: 'a', signal: 'request' }
    ]);
  });

  test('snapshot() is a deep copy isolated from later mutation on either side', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);

    emit({ placementId: 'a', signal: 'request' });

    const snap1 = collector.snapshot();
    // mutate returned snapshot -> collector unaffected
    snap1.events.push({ placementId: 'z', signal: 'z' });
    snap1.events[0].placementId = 'mutated';

    const snap2 = collector.snapshot();
    expect(snap2.events).toEqual([{ placementId: 'a', signal: 'request' }]);

    // mutate collector after taking snap2 -> snap2 unaffected
    emit({ placementId: 'c', signal: 'request' });
    expect(snap2.events).toEqual([{ placementId: 'a', signal: 'request' }]);
  });

  test('extra fields on incoming events are stripped, never appearing in the snapshot', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);

    // extra fields that must be dropped defensively
    const eventWithExtras: PlacementLifecycleEvent & { url: string; payload: { token: string } } = {
      placementId: 'a',
      signal: 'request',
      url: 'https://example.com/secret',
      payload: { token: 'abc' }
    };
    emit(eventWithExtras);

    const snap = collector.snapshot();
    expect(snap.events).toHaveLength(1);
    expect(Object.keys(snap.events[0]).sort()).toEqual(['placementId', 'signal']);
    expect(snap.events[0]).toEqual({ placementId: 'a', signal: 'request' });
  });

  test('countMatching matrix: exact match, wrong id, wrong signal, duplicates', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);

    emit({ placementId: 'a', signal: 'request' });
    emit({ placementId: 'a', signal: 'request' });
    emit({ placementId: 'a', signal: 'render' });
    emit({ placementId: 'b', signal: 'request' });

    expect(collector.countMatching('a', 'request')).toBe(2);
    expect(collector.countMatching('nope', 'request')).toBe(0);
    expect(collector.countMatching('a', 'nope')).toBe(0);
    expect(collector.countMatching('b', 'request')).toBe(1);
  });
});

test.describe('evaluateRequest', () => {
  test('configured and matching -> requestObserved:true, count>=1', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { request: 'ad-request' } });

    emit({ placementId: definition.id, signal: 'ad-request' });
    emit({ placementId: definition.id, signal: 'ad-request' });

    const observation = evaluateRequest(definition, collector);
    expect(observation).toEqual({
      placementId: definition.id,
      requestSignal: 'ad-request',
      requestObserved: true,
      count: 2
    });
  });

  test('configured and missing -> requestObserved:false, count:0', () => {
    const { source } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { request: 'ad-request' } });

    const observation = evaluateRequest(definition, collector);
    expect(observation).toEqual({
      placementId: definition.id,
      requestSignal: 'ad-request',
      requestObserved: false,
      count: 0
    });
  });

  test('no events/events.request -> requestObserved:undefined, count:0, requestSignal:null', () => {
    const { source } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition();

    const observation = evaluateRequest(definition, collector);
    expect(observation).toEqual({
      placementId: definition.id,
      requestSignal: null,
      requestObserved: undefined,
      count: 0
    });
  });

  test('toRequestSignals projects the requestObserved shape', () => {
    const observation = evaluateRequest(baseDefinition({ events: { request: 'ad-request' } }), createPlacementEventsCollector(makeFakeSource().source));
    expect(toRequestSignals(observation)).toEqual({ requestObserved: false });
  });
});

test.describe('classifyPlacement integration with toRequestSignals', () => {
  const containerSignals: Pick<PlacementSignals, 'applicable' | 'containerFound'> = {
    applicable: true,
    containerFound: true
  };

  test('container ready + request observed -> requested', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { request: 'ad-request' } });
    emit({ placementId: definition.id, signal: 'ad-request' });

    const observation = evaluateRequest(definition, collector);
    const signals: PlacementSignals = { ...containerSignals, ...toRequestSignals(observation) };
    const result = classifyPlacement(definition.id, signals);

    expect(result.state).toBe('requested');
  });

  test('container ready + request configured-but-missing -> request_missing', () => {
    const { source } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { request: 'ad-request' } });

    const observation = evaluateRequest(definition, collector);
    const signals: PlacementSignals = { ...containerSignals, ...toRequestSignals(observation) };
    const result = classifyPlacement(definition.id, signals);

    expect(result.state).toBe('request_missing');
  });

  test('container ready + request not observable (undefined) -> container_ready', () => {
    const { source } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition();

    const observation = evaluateRequest(definition, collector);
    const signals: PlacementSignals = { ...containerSignals, ...toRequestSignals(observation) };
    const result = classifyPlacement(definition.id, signals);

    expect(result.state).toBe('container_ready');
  });
});

test.describe('privacy', () => {
  test('no snapshot/observation field carries a URL/payload string', () => {
    const { source, emit } = makeFakeSource();
    const collector = createPlacementEventsCollector(source);
    const definition = baseDefinition({ events: { request: 'ad-request' } });

    const eventWithUrl: PlacementLifecycleEvent & { url: string } = {
      placementId: definition.id,
      signal: 'ad-request',
      url: 'https://vendor.example.com/secret?token=abc'
    };
    emit(eventWithUrl);

    const snap = collector.snapshot();
    const observation = evaluateRequest(definition, collector);

    const serializedSnapshot = JSON.stringify(snap);
    const serializedObservation = JSON.stringify(observation);

    expect(serializedSnapshot).not.toMatch(/https?:\/\//);
    expect(serializedSnapshot).not.toContain('token');
    expect(serializedObservation).not.toMatch(/https?:\/\//);
    expect(serializedObservation).not.toContain('token');
  });
});
