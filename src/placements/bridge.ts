import type { PlacementEventSourceLike, PlacementLifecycleEvent } from './events.js';

/**
 * Real Playwright event bridge backing `PlacementEventSourceLike`. See
 * docs/features/playwright-placement-event-bridge/SPEC.md and
 * docs/ads/PLACEMENT_MODEL.md. Request/render outcomes are page-emitted DEBUG
 * events (consistent with this project's consent/ads/country debug-signal
 * adapters), NOT inferred from raw network traffic — so no URL/header/body or
 * vendor payload is ever captured. The bridge is the single point where
 * untrusted page data enters, so it hard-normalizes every incoming call to
 * exactly `{ placementId, signal }` and drops everything else.
 *
 * DI structural interface: a real Playwright `Page` satisfies
 * `PlacementBindingPageLike`, but no Playwright is imported here or in tests.
 */
export interface PlacementBindingPageLike {
  exposeFunction(name: string, callback: (payload: unknown) => void): Promise<unknown>;
}

export interface PlacementEventBridgeOptions {
  /** Global function the page calls to emit an event. Default `__qaPlacementEvent`. */
  bindingName?: string;
}

export const DEFAULT_PLACEMENT_BINDING_NAME = '__qaPlacementEvent';

/**
 * Pure normalizer / privacy guard. Accepts ONLY an object with non-empty
 * string `placementId` and `signal`, returning EXACTLY `{ placementId,
 * signal }` (every other field on the incoming payload is dropped, never
 * spread). Returns `null` for any malformed input so nothing is forwarded.
 */
export function normalizePlacementPayload(payload: unknown): PlacementLifecycleEvent | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const { placementId, signal } = payload as Record<string, unknown>;
  if (typeof placementId !== 'string' || placementId.length === 0) {
    return null;
  }
  if (typeof signal !== 'string' || signal.length === 0) {
    return null;
  }

  return { placementId, signal };
}

/**
 * Installs the page-side binding and returns a `PlacementEventSourceLike`.
 * Registers exactly one exposed function (`options.bindingName`); each call
 * is normalized via `normalizePlacementPayload` and dispatched to every
 * handler registered through `on('placement', ...)`. Handlers must be
 * registered BEFORE the page navigates (mirrors the collector's
 * subscribe-at-construction contract), since page events only fire after
 * navigation and are dispatched to the currently-registered handlers.
 */
export async function installPlacementEventBridge(
  page: PlacementBindingPageLike,
  options?: PlacementEventBridgeOptions
): Promise<PlacementEventSourceLike> {
  const bindingName = options?.bindingName ?? DEFAULT_PLACEMENT_BINDING_NAME;
  const handlers: Array<(e: PlacementLifecycleEvent) => void> = [];

  await page.exposeFunction(bindingName, (payload: unknown) => {
    const event = normalizePlacementPayload(payload);
    if (event === null) {
      return;
    }
    for (const handler of handlers) {
      handler(event);
    }
  });

  return {
    on(event: 'placement', handler: (e: PlacementLifecycleEvent) => void): void {
      if (event === 'placement') {
        handlers.push(handler);
      }
    }
  };
}
