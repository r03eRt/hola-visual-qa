import type { Scenario } from '../domain/index.js';
import type { PlacementDefinition } from './model.js';

/**
 * Pure, deterministic selection of the placement definitions applicable to a
 * scenario's PAGE. A placement applies when its `pages` list references the
 * scenario page either by `page.path` or by its optional `page.name` — the
 * two identifiers a `ProjectConfig` page can be addressed by. Device
 * applicability is intentionally NOT filtered here: `evaluateContainer` (in
 * container.ts) already asserts the correct per-device expectation, including
 * that a placement hidden on this device is genuinely absent/invisible, so
 * every page-matched placement is checked on every device.
 *
 * No fs/Date/random/env/DOM; input order of `placements` is preserved.
 */
export function placementsForScenario(
  placements: readonly PlacementDefinition[],
  scenario: Scenario
): PlacementDefinition[] {
  const { path, name } = scenario.page;
  return placements.filter((placement) => placement.pages.some((page) => page === path || (name !== undefined && page === name)));
}
