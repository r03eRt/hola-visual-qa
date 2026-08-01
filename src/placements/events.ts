/**
 * Generic, dependency-injected placement lifecycle event collector. See
 * docs/features/placement-request-events/SPEC.md. This module is generic:
 * item 18 (render events) reuses it unchanged over the same `'placement'`
 * event source. Mirrors `src/diagnostics/collector.ts`'s
 * subscribe-at-construction + insertion-order accumulation + deep-copy
 * `snapshot()` isolation, and `src/diagnostics/page-events.ts`'s DI
 * `on(...)` event-source interface style. No DOM/browser import.
 */

/** An already-normalized, approved lifecycle event. NO url/header/body/payload. */
export interface PlacementLifecycleEvent {
  placementId: string;
  signal: string;
}

/** DI event source; a real page binding / documented event bridge satisfies this. */
export interface PlacementEventSourceLike {
  on(event: 'placement', handler: (e: PlacementLifecycleEvent) => void): void;
}

export interface PlacementEventsSnapshot {
  events: PlacementLifecycleEvent[];
}

export interface PlacementEventsCollector {
  /** Deep copy, insertion order — isolated from later mutation on either side. */
  snapshot(): PlacementEventsSnapshot;
  /** Count of accumulated events whose placementId AND signal match exactly (case-sensitive). */
  countMatching(placementId: string, signal: string): number;
}

/**
 * Creates a placement events collector attached to `source`. Registers
 * exactly one `on('placement', ...)` handler on construction; each incoming
 * event is normalized to EXACTLY `{ placementId, signal }` (extra fields on
 * the incoming object are dropped, defensively, so secrets/payloads never
 * enter the accumulated events) and pushed in insertion order.
 */
export function createPlacementEventsCollector(source: PlacementEventSourceLike): PlacementEventsCollector {
  const events: PlacementLifecycleEvent[] = [];

  source.on('placement', (e: PlacementLifecycleEvent) => {
    events.push({ placementId: e.placementId, signal: e.signal });
  });

  return {
    snapshot(): PlacementEventsSnapshot {
      return { events: events.map(entry => ({ ...entry })) };
    },
    countMatching(placementId: string, signal: string): number {
      return events.filter(entry => entry.placementId === placementId && entry.signal === signal).length;
    }
  };
}
