import { test, expect } from '@playwright/test';
import {
  installPlacementEventBridge,
  normalizePlacementPayload,
  createPlacementEventsCollector,
  DEFAULT_PLACEMENT_BINDING_NAME,
  type PlacementBindingPageLike,
  type PlacementLifecycleEvent
} from '../../src/placements/index.js';

/**
 * Fake Playwright page — records exposeFunction registrations and lets the
 * test drive the page-side call back into the bridge. No real browser.
 */
class FakeBindingPage implements PlacementBindingPageLike {
  readonly registered: string[] = [];
  private callbacks = new Map<string, (payload: unknown) => void>();

  async exposeFunction(name: string, callback: (payload: unknown) => void): Promise<unknown> {
    this.registered.push(name);
    this.callbacks.set(name, callback);
    return undefined;
  }

  /** Simulate the page calling `window[name](payload)`. */
  emit(name: string, payload: unknown): void {
    this.callbacks.get(name)?.(payload);
  }
}

test.describe('normalizePlacementPayload', () => {
  test('accepts a well-formed payload and returns exactly {placementId, signal}', () => {
    expect(normalizePlacementPayload({ placementId: 'top', signal: 'req' })).toEqual({ placementId: 'top', signal: 'req' });
  });

  test('drops every extra field (no url/payload/secret can pass through)', () => {
    const out = normalizePlacementPayload({
      placementId: 'top',
      signal: 'req',
      url: 'https://ads.example/vast?token=SECRET',
      token: 'SECRET',
      payload: { foo: 1 }
    });
    expect(out).toEqual({ placementId: 'top', signal: 'req' });
    expect(Object.keys(out ?? {})).toEqual(['placementId', 'signal']);
  });

  test('rejects malformed payloads', () => {
    expect(normalizePlacementPayload(null)).toBeNull();
    expect(normalizePlacementPayload('nope')).toBeNull();
    expect(normalizePlacementPayload(42)).toBeNull();
    expect(normalizePlacementPayload({})).toBeNull();
    expect(normalizePlacementPayload({ placementId: 'top' })).toBeNull();
    expect(normalizePlacementPayload({ signal: 'req' })).toBeNull();
    expect(normalizePlacementPayload({ placementId: '', signal: 'req' })).toBeNull();
    expect(normalizePlacementPayload({ placementId: 'top', signal: '' })).toBeNull();
    expect(normalizePlacementPayload({ placementId: 1, signal: 'req' })).toBeNull();
  });
});

test.describe('installPlacementEventBridge', () => {
  test('registers exactly one binding under the default name', async () => {
    const page = new FakeBindingPage();
    await installPlacementEventBridge(page);
    expect(page.registered).toEqual([DEFAULT_PLACEMENT_BINDING_NAME]);
  });

  test('honours a custom binding name', async () => {
    const page = new FakeBindingPage();
    await installPlacementEventBridge(page, { bindingName: '__custom' });
    expect(page.registered).toEqual(['__custom']);
  });

  test('dispatches normalized events to registered handlers, dropping malformed calls', async () => {
    const page = new FakeBindingPage();
    const source = await installPlacementEventBridge(page);
    const received: PlacementLifecycleEvent[] = [];
    source.on('placement', (e) => received.push(e));

    page.emit(DEFAULT_PLACEMENT_BINDING_NAME, { placementId: 'top', signal: 'req', url: 'https://x/y?token=SECRET' });
    page.emit(DEFAULT_PLACEMENT_BINDING_NAME, 'garbage');
    page.emit(DEFAULT_PLACEMENT_BINDING_NAME, { placementId: 'top', signal: 'render:rendered' });

    expect(received).toEqual([
      { placementId: 'top', signal: 'req' },
      { placementId: 'top', signal: 'render:rendered' }
    ]);
  });

  test('feeds the real PlacementEventsCollector end to end', async () => {
    const page = new FakeBindingPage();
    const source = await installPlacementEventBridge(page);
    const collector = createPlacementEventsCollector(source);

    page.emit(DEFAULT_PLACEMENT_BINDING_NAME, { placementId: 'top', signal: 'req' });
    page.emit(DEFAULT_PLACEMENT_BINDING_NAME, { placementId: 'top', signal: 'req' });
    page.emit(DEFAULT_PLACEMENT_BINDING_NAME, { placementId: 'top', signal: 'render:empty' });

    expect(collector.countMatching('top', 'req')).toBe(2);
    expect(collector.countMatching('top', 'render:empty')).toBe(1);
    expect(collector.countMatching('top', 'render:rendered')).toBe(0);
    const snapshot = collector.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain('token');
  });
});
