import type { Scenario } from '../domain/index.js';

/**
 * Include/exclude filter applied by `planScenarios` after cartesian
 * expansion. Include fields NARROW the plan (a scenario must match every
 * populated include field); `excludeCombinations` REMOVES matches — exclude
 * always wins over include.
 */
export interface ExcludeCombination {
  /** Matches a page by `path` OR `name`. */
  page?: string;
  device?: 'desktop' | 'mobile';
  consent?: 'accepted' | 'rejected';
  /** Case-insensitive country match. */
  country?: string;
  ads?: boolean;
  /** Matches if the scenario's tags include this tag. */
  tag?: string;
}

export interface ScenarioFilter {
  /** Match a page by `path` OR `name`. */
  pages?: string[];
  /** Scenario must have at least one of these tags. */
  tags?: string[];
  devices?: Array<'desktop' | 'mobile'>;
  consent?: Array<'accepted' | 'rejected'>;
  /** Case-insensitive country match. */
  countries?: string[];
  ads?: boolean[];
  /** Any fully-matching combination removes the scenario from the plan. */
  excludeCombinations?: ExcludeCombination[];
}

function matchesPage(scenario: Scenario, page: string): boolean {
  return scenario.page.path === page || scenario.page.name === page;
}

function includesCaseInsensitive(values: string[], value: string): boolean {
  return values.some((candidate) => candidate.toLowerCase() === value.toLowerCase());
}

function matchesIncludeFilters(scenario: Scenario, filter: ScenarioFilter): boolean {
  if (filter.pages && filter.pages.length > 0) {
    if (!filter.pages.some((page) => matchesPage(scenario, page))) {
      return false;
    }
  }

  if (filter.tags && filter.tags.length > 0) {
    const scenarioTags = scenario.tags ?? [];
    if (!filter.tags.some((tag) => scenarioTags.includes(tag))) {
      return false;
    }
  }

  if (filter.devices && filter.devices.length > 0 && !filter.devices.includes(scenario.device)) {
    return false;
  }

  if (filter.consent && filter.consent.length > 0 && !filter.consent.includes(scenario.consent)) {
    return false;
  }

  if (filter.countries && filter.countries.length > 0 && !includesCaseInsensitive(filter.countries, scenario.country)) {
    return false;
  }

  if (filter.ads && filter.ads.length > 0 && !filter.ads.includes(scenario.adsEnabled)) {
    return false;
  }

  return true;
}

function matchesExcludeCombination(scenario: Scenario, exclude: ExcludeCombination): boolean {
  if (exclude.page !== undefined && !matchesPage(scenario, exclude.page)) {
    return false;
  }

  if (exclude.device !== undefined && scenario.device !== exclude.device) {
    return false;
  }

  if (exclude.consent !== undefined && scenario.consent !== exclude.consent) {
    return false;
  }

  if (exclude.country !== undefined && scenario.country.toLowerCase() !== exclude.country.toLowerCase()) {
    return false;
  }

  if (exclude.ads !== undefined && scenario.adsEnabled !== exclude.ads) {
    return false;
  }

  if (exclude.tag !== undefined && !(scenario.tags ?? []).includes(exclude.tag)) {
    return false;
  }

  // A combination with no populated fields matches nothing, to avoid
  // accidentally excluding the entire plan.
  const hasAnyField =
    exclude.page !== undefined ||
    exclude.device !== undefined ||
    exclude.consent !== undefined ||
    exclude.country !== undefined ||
    exclude.ads !== undefined ||
    exclude.tag !== undefined;

  return hasAnyField;
}

function matchesAnyExcludeCombination(scenario: Scenario, exclusions: ExcludeCombination[]): boolean {
  return exclusions.some((exclude) => matchesExcludeCombination(scenario, exclude));
}

/**
 * `true` when the scenario should be INCLUDED in the plan: it satisfies
 * every populated include field, AND does not match any
 * `excludeCombinations` entry (exclude always wins).
 */
export function matchesFilter(scenario: Scenario, filter: ScenarioFilter | undefined): boolean {
  if (!filter) {
    return true;
  }

  if (!matchesIncludeFilters(scenario, filter)) {
    return false;
  }

  if (filter.excludeCombinations && filter.excludeCombinations.length > 0) {
    if (matchesAnyExcludeCombination(scenario, filter.excludeCombinations)) {
      return false;
    }
  }

  return true;
}
