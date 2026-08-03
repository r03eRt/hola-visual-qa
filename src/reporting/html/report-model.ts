/**
 * Pure, render-ready view model for the custom HTML report (SPEC-009 /
 * docs/features/custom-html-report/SPEC.md). No fs/Date/random; deterministic
 * ordering; never mutates inputs.
 */

import type {
  ArtifactRefs,
  NormalizedError,
  RunCounts,
  RunResult,
  ScenarioStatus
} from '../../domain/index.js';
import type { AiAnalysis } from '../../ai/analysis.js';
import { groupFailuresByPage, type PageFailureGroup } from '../aggregate.js';

export interface ScenarioReportRow {
  scenarioId: string;
  page: string;
  pageName?: string;
  device: 'desktop' | 'mobile';
  consent: 'accepted' | 'rejected';
  country: string;
  adsEnabled: boolean;
  status: ScenarioStatus;
  category?: string;
  message?: string;
  artifacts?: ArtifactRefs;
  analysis?: AiAnalysis;
}

export interface ReportModel {
  runId: string;
  startedAt: string;
  finishedAt: string;
  counts: RunCounts;
  deterministicFailure: boolean;
  tool: { version: string; os: string; browser: string };
  groups: PageFailureGroup[];
  rows: ScenarioReportRow[];
}

export interface BuildReportModelOptions {
  analyses?: ReadonlyMap<string, AiAnalysis>;
}

/**
 * Mirrors aggregate.ts' pickProbableError: the first non-warning error, else
 * the first error, else undefined when there are none.
 */
function pickProbableError(errors: readonly NormalizedError[]): NormalizedError | undefined {
  const firstNonWarning = errors.find((error) => error.severity !== 'warning');
  return firstNonWarning ?? errors[0];
}

export function buildReportModel(run: RunResult, options: BuildReportModelOptions = {}): ReportModel {
  const groups = groupFailuresByPage(run.results);

  const rows: ScenarioReportRow[] = run.results.map((result) => {
    const probableError = pickProbableError(result.errors);
    const analysis = options.analyses?.get(result.scenario.id);

    return {
      scenarioId: result.scenario.id,
      page: result.scenario.page.path,
      ...(result.scenario.page.name !== undefined ? { pageName: result.scenario.page.name } : {}),
      device: result.scenario.device,
      consent: result.scenario.consent,
      country: result.scenario.country,
      adsEnabled: result.scenario.adsEnabled,
      status: result.status,
      ...(probableError !== undefined ? { category: probableError.category, message: probableError.message } : {}),
      ...(result.artifacts !== undefined ? { artifacts: result.artifacts } : {}),
      ...(analysis !== undefined ? { analysis } : {})
    };
  });

  return {
    runId: run.runId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    counts: run.counts,
    deterministicFailure: run.deterministicFailure,
    tool: {
      version: run.manifest.toolVersion,
      os: run.manifest.os,
      browser: `${run.manifest.browser.name} ${run.manifest.browser.version}`
    },
    groups,
    rows
  };
}
