/**
 * Pure failure-grouping engine layered on `groupFailuresByPage`: groups
 * failures by probable category, by page-and-category (nested), and a
 * run-level failure summary. Reuses the shared `countsAsFailure`/
 * `toFailureItem` from `aggregate.ts` as the single source of truth for
 * "counts as a failure" and "probable error". See
 * docs/features/failure-grouping/SPEC.md and docs/specs/SPEC-009-REPORTING.md.
 * No fs/Date/random; deterministic ordering; never mutates inputs.
 */

import type { ScenarioResult } from '../domain/index.js';
import { countsAsFailure, toFailureItem, type FailureItem } from './aggregate.js';

export interface CategoryFailureGroup {
  category: string;
  failures: FailureItem[];
}

export interface PageCategoryGroup {
  page: string;
  pageName?: string;
  categories: CategoryFailureGroup[];
  total: number;
}

export interface CategoryTally {
  category: string;
  count: number;
}

export interface PageTally {
  page: string;
  pageName?: string;
  count: number;
}

export interface FailureSummary {
  total: number;
  byCategory: CategoryTally[];
  byPage: PageTally[];
}

/**
 * Orders category buckets by descending failure count, breaking ties by
 * first-appearance (the order categories were first seen). Uses a stable
 * sort keyed on [-count, firstSeenIndex].
 */
function orderCategoryGroups(
  groups: CategoryFailureGroup[],
  firstSeenIndexByCategory: Map<string, number>
): CategoryFailureGroup[] {
  return [...groups].sort((a, b) => {
    const countDiff = b.failures.length - a.failures.length;
    if (countDiff !== 0) {
      return countDiff;
    }
    const aIndex = firstSeenIndexByCategory.get(a.category) ?? 0;
    const bIndex = firstSeenIndexByCategory.get(b.category) ?? 0;
    return aIndex - bIndex;
  });
}

/** Buckets failing results by probable category, keeping input order within a bucket. */
export function groupFailuresByCategory(results: readonly ScenarioResult[]): CategoryFailureGroup[] {
  const groups: CategoryFailureGroup[] = [];
  const groupIndexByCategory = new Map<string, number>();
  const firstSeenIndexByCategory = new Map<string, number>();

  for (const result of results) {
    if (!countsAsFailure(result)) {
      continue;
    }

    const item = toFailureItem(result);
    let groupIndex = groupIndexByCategory.get(item.category);

    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groupIndexByCategory.set(item.category, groupIndex);
      firstSeenIndexByCategory.set(item.category, groups.length);
      groups.push({ category: item.category, failures: [] });
    }

    groups[groupIndex]!.failures.push(item);
  }

  return orderCategoryGroups(groups, firstSeenIndexByCategory);
}

/**
 * Page buckets in first-seen order; within each page, categories are ordered
 * by descending count then first-appearance scoped to that page.
 */
export function groupFailuresByPageAndCategory(results: readonly ScenarioResult[]): PageCategoryGroup[] {
  interface PageBucket {
    page: string;
    pageName?: string;
    categoryGroups: CategoryFailureGroup[];
    categoryIndexByCategory: Map<string, number>;
    firstSeenIndexByCategory: Map<string, number>;
  }

  const pageBuckets: PageBucket[] = [];
  const pageIndexByPage = new Map<string, number>();

  for (const result of results) {
    if (!countsAsFailure(result)) {
      continue;
    }

    const item = toFailureItem(result);
    let pageIndex = pageIndexByPage.get(item.page);

    if (pageIndex === undefined) {
      pageIndex = pageBuckets.length;
      pageIndexByPage.set(item.page, pageIndex);
      pageBuckets.push({
        page: item.page,
        ...(item.pageName !== undefined ? { pageName: item.pageName } : {}),
        categoryGroups: [],
        categoryIndexByCategory: new Map(),
        firstSeenIndexByCategory: new Map()
      });
    }

    const bucket = pageBuckets[pageIndex]!;
    let categoryIndex = bucket.categoryIndexByCategory.get(item.category);

    if (categoryIndex === undefined) {
      categoryIndex = bucket.categoryGroups.length;
      bucket.categoryIndexByCategory.set(item.category, categoryIndex);
      bucket.firstSeenIndexByCategory.set(item.category, bucket.categoryGroups.length);
      bucket.categoryGroups.push({ category: item.category, failures: [] });
    }

    bucket.categoryGroups[categoryIndex]!.failures.push(item);
  }

  return pageBuckets.map((bucket) => {
    const categories = orderCategoryGroups(bucket.categoryGroups, bucket.firstSeenIndexByCategory);
    const total = categories.reduce((sum, group) => sum + group.failures.length, 0);

    return {
      page: bucket.page,
      ...(bucket.pageName !== undefined ? { pageName: bucket.pageName } : {}),
      categories,
      total
    };
  });
}

/** Run-level tallies by category and by page; `total` is the failing-result count. */
export function summarizeFailures(results: readonly ScenarioResult[]): FailureSummary {
  const byCategory: CategoryTally[] = groupFailuresByCategory(results).map((group) => ({
    category: group.category,
    count: group.failures.length
  }));

  const byPage: PageTally[] = [];
  const pageIndexByPage = new Map<string, number>();

  for (const result of results) {
    if (!countsAsFailure(result)) {
      continue;
    }

    const item = toFailureItem(result);
    let pageIndex = pageIndexByPage.get(item.page);

    if (pageIndex === undefined) {
      pageIndex = byPage.length;
      pageIndexByPage.set(item.page, pageIndex);
      byPage.push({
        page: item.page,
        ...(item.pageName !== undefined ? { pageName: item.pageName } : {}),
        count: 0
      });
    }

    byPage[pageIndex]!.count += 1;
  }

  const total = byCategory.reduce((sum, tally) => sum + tally.count, 0);

  return { total, byCategory, byPage };
}
