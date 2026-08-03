import { test, expect } from '@playwright/test';
import type { Scenario } from '../../src/domain/index.js';
import { parsePlacementDefinition, placementsForScenario, type PlacementDefinition } from '../../src/placements/index.js';

function def(overrides: Partial<Parameters<typeof parsePlacementDefinition>[0] & object> = {}): PlacementDefinition {
  return parsePlacementDefinition({
    id: 'top-banner',
    pages: ['/'],
    containerSelector: '#top-ad',
    allowedSizes: [{ width: 970, height: 250 }],
    ...overrides
  });
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'home-desktop-accepted-es-ads_on',
    page: { path: '/', name: 'home' },
    device: 'desktop',
    consent: 'accepted',
    country: 'ES',
    adsEnabled: true,
    ...overrides
  };
}

test.describe('placementsForScenario', () => {
  test('returns an empty list when no placements are configured', () => {
    expect(placementsForScenario([], scenario())).toEqual([]);
  });

  test('selects placements whose pages match the scenario page path', () => {
    const banner = def({ id: 'a', pages: ['/'] });
    const other = def({ id: 'b', pages: ['/pricing'] });
    const selected = placementsForScenario([banner, other], scenario({ page: { path: '/' } }));
    expect(selected.map((p) => p.id)).toEqual(['a']);
  });

  test('matches by the page name as well as the path', () => {
    const banner = def({ id: 'a', pages: ['home'] });
    const selected = placementsForScenario([banner], scenario({ page: { path: '/', name: 'home' } }));
    expect(selected.map((p) => p.id)).toEqual(['a']);
  });

  test('does not match a name when the scenario page has no name', () => {
    const banner = def({ id: 'a', pages: ['home'] });
    const selected = placementsForScenario([banner], scenario({ page: { path: '/' } }));
    expect(selected).toEqual([]);
  });

  test('selects every page-matched placement regardless of device visibility', () => {
    const desktopOnly = def({ id: 'a', pages: ['/'], visibility: { desktop: true, mobile: false } });
    const mobileOnly = def({ id: 'b', pages: ['/'], visibility: { desktop: false, mobile: true } });
    const selected = placementsForScenario([desktopOnly, mobileOnly], scenario({ device: 'mobile', page: { path: '/' } }));
    expect(selected.map((p) => p.id)).toEqual(['a', 'b']);
  });

  test('preserves input order of the matched placements', () => {
    const first = def({ id: 'first', pages: ['/'] });
    const second = def({ id: 'second', pages: ['/'] });
    const selected = placementsForScenario([first, second], scenario({ page: { path: '/' } }));
    expect(selected.map((p) => p.id)).toEqual(['first', 'second']);
  });

  test('does not mutate the input placements array', () => {
    const placements = [def({ id: 'a', pages: ['/'] }), def({ id: 'b', pages: ['/pricing'] })];
    const before = placements.map((p) => p.id);
    placementsForScenario(placements, scenario());
    expect(placements.map((p) => p.id)).toEqual(before);
  });
});
