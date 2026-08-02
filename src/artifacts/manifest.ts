/**
 * Builders for the secret-free `manifest.json` and `summary.json` payloads.
 * No browser launch happens here; browser info is supplied by the caller.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectConfig } from '../config/schema.js';
import {
  parseRunManifest,
  parseRunSummary,
  type RunCounts,
  type RunManifest,
  type RunSummary
} from '../domain/index.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Recursively sorts object keys so structurally-equal configs (regardless
 * of property insertion order) serialize to identical JSON text. Arrays
 * keep their order (order is significant there).
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value !== null && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    const result: Record<string, unknown> = {};
    for (const [key, entry] of sortedEntries) {
      result[key] = canonicalize(entry);
    }
    return result;
  }
  return value;
}

/** Stable sha256 hex digest over the canonicalized JSON form of `value`. */
export function canonicalJsonHash(value: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(value));
  return createHash('sha256').update(canonicalJson).digest('hex');
}

/** Reads the tool's own package.json `version` field. */
export function readToolVersion(): string {
  const packageJsonPath = path.resolve(MODULE_DIR, '../../package.json');
  const raw = readFileSync(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  if (!parsed.version) {
    throw new Error(`package.json at ${packageJsonPath} is missing a "version" field`);
  }
  return parsed.version;
}

export interface BuildRunManifestInput {
  /** Defaults to `readToolVersion()` when omitted. */
  toolVersion?: string;
  commitSha?: string;
  /** Defaults to `${process.platform} ${process.arch}` when omitted. */
  os?: string;
  browser: { name: string; version: string };
  config: ProjectConfig;
  baselineHash?: string;
  scenarioIds: readonly string[];
  /** Resolved URL inventory, included only when provided. */
  inventory?: RunManifest['inventory'];
  /** Defaults to `new Date().toISOString()` when omitted. */
  createdAt?: string;
}

/** Builds and validates a schema-conformant `RunManifest`. */
export function buildRunManifest(input: BuildRunManifestInput): RunManifest {
  const candidate = {
    toolVersion: input.toolVersion ?? readToolVersion(),
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    os: input.os ?? `${process.platform} ${process.arch}`,
    browser: input.browser,
    configHash: canonicalJsonHash(input.config),
    ...(input.baselineHash ? { baselineHash: input.baselineHash } : {}),
    scenarioIds: [...input.scenarioIds],
    ...(input.inventory ? { inventory: input.inventory } : {}),
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  return parseRunManifest(candidate);
}

export interface BuildRunSummaryInput {
  runId: string;
  startedAt: string;
  finishedAt: string;
  counts: RunCounts;
  deterministicFailure: boolean;
}

/** Builds and validates a schema-conformant `RunSummary`. */
export function buildRunSummary(input: BuildRunSummaryInput): RunSummary {
  const candidate = {
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    counts: input.counts,
    deterministicFailure: input.deterministicFailure
  };
  return parseRunSummary(candidate);
}
