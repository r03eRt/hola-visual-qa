import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArtifactRefsSchema } from '../../src/domain/index.js';
import { isRunId, newRunId, RUN_ID_PATTERN } from '../../src/artifacts/run-id.js';
import {
  ARTIFACT_FILENAMES,
  buildArtifactRefs,
  manifestPath,
  relativeArtifactRef,
  reportIndexPath,
  runDir,
  scenarioArtifactPath,
  scenarioDir,
  scenarioResultPath,
  summaryPath,
  type ArtifactKind
} from '../../src/artifacts/paths.js';
import {
  buildRunManifest,
  buildRunSummary,
  canonicalJsonHash
} from '../../src/artifacts/manifest.js';
import { ensureRunDir, ensureScenarioDir, writeManifest, writeSummary } from '../../src/artifacts/writer.js';
import { parseRunManifest, parseRunSummary } from '../../src/domain/index.js';
import type { ProjectConfig } from '../../src/config/schema.js';

function validConfig(): ProjectConfig {
  return {
    schemaVersion: 1,
    projectName: 'hola-visual-qa',
    baseUrl: 'https://example.com',
    allowedHosts: ['example.com'],
    pages: [{ path: '/' }],
    dimensions: {
      device: ['desktop', 'mobile'],
      consent: ['accepted', 'rejected'],
      country: ['ES'],
      ads: [true, false]
    },
    adapters: { consent: {}, ads: { strategy: 'init-script' }, country: { strategy: 'none' }, user: { fixtures: [] } },
    visual: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
    diagnostics: { captureConsole: true, captureNetwork: true, ignoredDomains: [] },
    artifacts: { outputDir: 'reports', retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none' },
    execution: { retries: 0 }
  } as ProjectConfig;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hola-artifacts-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test.describe('run-id', () => {
  test('newRunId() matches the documented pattern', () => {
    const id = newRunId(new Date('2026-07-31T13:52:00.123Z'));
    expect(id).toBe('20260731T135200Z-' + id.split('-')[1]);
    expect(RUN_ID_PATTERN.test(id)).toBe(true);
  });

  test('lexical sort order matches chronological order for an increasing clock', () => {
    const ids = [
      newRunId(new Date('2026-01-01T00:00:00.000Z')),
      newRunId(new Date('2026-01-01T00:00:01.000Z')),
      newRunId(new Date('2026-06-15T12:30:45.000Z')),
      newRunId(new Date('2027-01-01T00:00:00.000Z'))
    ];
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  test('two calls at the same instant produce different IDs', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const ids = new Set(Array.from({ length: 50 }, () => newRunId(now)));
    expect(ids.size).toBe(50);
  });

  test('rapid successive calls (default clock) are unique', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRunId()));
    expect(ids.size).toBe(50);
  });

  test('run IDs are filesystem-safe (no path separators or reserved chars)', () => {
    const id = newRunId();
    expect(id).not.toMatch(/[\\/:*?"<>|]/);
  });

  test('isRunId accepts a generated ID and rejects junk', () => {
    expect(isRunId(newRunId())).toBe(true);
    expect(isRunId('not-a-run-id')).toBe(false);
    expect(isRunId('../../etc/passwd')).toBe(false);
    expect(isRunId('')).toBe(false);
    expect(isRunId('20260731T135200Z')).toBe(false);
  });
});

test.describe('paths', () => {
  const OUTPUT_DIR = '/base/reports';
  const RUN_ID = '20260731T135200Z-a1b2c3';
  const SCENARIO_ID = 'home-desktop-accepted-ES-ads';

  test('every ArtifactRefs key maps to the documented canonical filename', () => {
    expect(ARTIFACT_FILENAMES).toEqual({
      expected: 'expected.png',
      actual: 'actual.png',
      diff: 'diff.png',
      console: 'console.json',
      pageErrors: 'page-errors.json',
      requests: 'requests.json',
      trace: 'trace.zip',
      video: 'video.webm',
      aiAnalysis: 'ai-analysis.json'
    });
  });

  test('runDir/manifestPath/summaryPath/reportIndexPath reproduce ARTIFACT_MODEL.md', () => {
    const dir = runDir(OUTPUT_DIR, RUN_ID);
    expect(dir).toBe(path.resolve(OUTPUT_DIR, RUN_ID));
    expect(manifestPath(OUTPUT_DIR, RUN_ID)).toBe(path.join(dir, 'manifest.json'));
    expect(summaryPath(OUTPUT_DIR, RUN_ID)).toBe(path.join(dir, 'summary.json'));
    expect(reportIndexPath(OUTPUT_DIR, RUN_ID)).toBe(path.join(dir, 'report', 'index.html'));
  });

  test('scenarioDir and scenarioResultPath are rooted under scenarios/<scenarioId>', () => {
    const dir = runDir(OUTPUT_DIR, RUN_ID);
    expect(scenarioDir(OUTPUT_DIR, RUN_ID, SCENARIO_ID)).toBe(
      path.join(dir, 'scenarios', SCENARIO_ID)
    );
    expect(scenarioResultPath(OUTPUT_DIR, RUN_ID, SCENARIO_ID)).toBe(
      path.join(dir, 'scenarios', SCENARIO_ID, 'result.json')
    );
  });

  test('scenarioArtifactPath returns the absolute path for every artifact kind', () => {
    const dir = scenarioDir(OUTPUT_DIR, RUN_ID, SCENARIO_ID);
    for (const kind of Object.keys(ARTIFACT_FILENAMES) as ArtifactKind[]) {
      expect(scenarioArtifactPath(OUTPUT_DIR, RUN_ID, SCENARIO_ID, kind)).toBe(
        path.join(dir, ARTIFACT_FILENAMES[kind])
      );
    }
  });

  test('relativeArtifactRef values are relative and accepted by ArtifactRefsSchema', () => {
    for (const kind of Object.keys(ARTIFACT_FILENAMES) as ArtifactKind[]) {
      const rel = relativeArtifactRef(SCENARIO_ID, kind);
      expect(path.isAbsolute(rel)).toBe(false);
      expect(rel).toBe(`scenarios/${SCENARIO_ID}/${ARTIFACT_FILENAMES[kind]}`);
      const parsed = ArtifactRefsSchema.safeParse({ [kind]: rel });
      expect(parsed.success).toBe(true);
    }
  });

  test('relativeArtifactRef paths resolve inside the run dir when joined', () => {
    const dir = runDir(OUTPUT_DIR, RUN_ID);
    const rel = relativeArtifactRef(SCENARIO_ID, 'actual');
    const resolved = path.resolve(dir, rel);
    expect(resolved.startsWith(dir + path.sep)).toBe(true);
    expect(resolved).toBe(scenarioArtifactPath(OUTPUT_DIR, RUN_ID, SCENARIO_ID, 'actual'));
  });

  test('buildArtifactRefs assembles an ArtifactRefs object validated by ArtifactRefsSchema', () => {
    const refs = buildArtifactRefs(SCENARIO_ID, ['expected', 'actual', 'diff']);
    expect(ArtifactRefsSchema.safeParse(refs).success).toBe(true);
    expect(refs).toEqual({
      expected: `scenarios/${SCENARIO_ID}/expected.png`,
      actual: `scenarios/${SCENARIO_ID}/actual.png`,
      diff: `scenarios/${SCENARIO_ID}/diff.png`
    });
  });

  test('rejects scenario IDs that would escape the run dir via traversal', () => {
    expect(() => scenarioDir(OUTPUT_DIR, RUN_ID, '../../etc')).toThrow();
    expect(() => scenarioDir(OUTPUT_DIR, RUN_ID, '..')).toThrow();
    expect(() => relativeArtifactRef('../escape', 'actual')).toThrow();
  });

  test('rejects an absolute scenario ID', () => {
    expect(() => scenarioDir(OUTPUT_DIR, RUN_ID, '/etc/passwd')).toThrow();
  });

  test('rejects a run ID that would escape the output dir via traversal', () => {
    expect(() => runDir(OUTPUT_DIR, '../escape')).toThrow();
  });

  test('rejects an unknown artifact kind', () => {
    expect(() =>
      scenarioArtifactPath(OUTPUT_DIR, RUN_ID, SCENARIO_ID, 'bogus' as ArtifactKind)
    ).toThrow();
  });
});

test.describe('manifest/summary builders', () => {
  test('buildRunManifest returns a schema-valid RunManifest', () => {
    const manifest = buildRunManifest({
      toolVersion: '0.1.0',
      os: 'darwin arm64',
      browser: { name: 'chromium', version: '120.0' },
      config: validConfig(),
      scenarioIds: ['home-desktop-accepted-ES-ads'],
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    expect(parseRunManifest(manifest)).toEqual(manifest);
    expect(manifest.toolVersion).toBe('0.1.0');
    expect(manifest.configHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('buildRunManifest reads toolVersion from package.json when omitted', () => {
    const manifest = buildRunManifest({
      os: 'darwin arm64',
      browser: { name: 'chromium', version: '120.0' },
      config: validConfig(),
      scenarioIds: []
    });
    expect(manifest.toolVersion.length).toBeGreaterThan(0);
  });

  test('configHash is identical for deeply-equal configs regardless of key order', () => {
    const config = validConfig();
    // Rebuild the same object with top-level keys inserted in reverse order.
    const reordered = Object.fromEntries(
      Object.entries(config).reverse()
    ) as unknown as ProjectConfig;
    // Also reorder a nested object's keys.
    const nestedReordered = {
      ...reordered,
      dimensions: {
        ads: reordered.dimensions.ads,
        country: reordered.dimensions.country,
        consent: reordered.dimensions.consent,
        device: reordered.dimensions.device
      }
    } as ProjectConfig;

    expect(canonicalJsonHash(config)).toBe(canonicalJsonHash(reordered));
    expect(canonicalJsonHash(config)).toBe(canonicalJsonHash(nestedReordered));
  });

  test('configHash changes when the config changes', () => {
    const config = validConfig();
    const changed = { ...config, projectName: 'different-project' };
    expect(canonicalJsonHash(config)).not.toBe(canonicalJsonHash(changed));
  });

  test('manifest contains no secret-looking fields', () => {
    const manifest = buildRunManifest({
      os: 'darwin arm64',
      browser: { name: 'chromium', version: '120.0' },
      config: validConfig(),
      scenarioIds: []
    });
    const serialized = JSON.stringify(manifest).toLowerCase();
    for (const secretWord of ['apikey', 'api_key', 'authorization', 'cookie', 'password', 'secret', 'token']) {
      expect(serialized).not.toContain(secretWord);
    }
  });

  test('buildRunSummary returns a schema-valid RunSummary', () => {
    const summary = buildRunSummary({
      runId: newRunId(),
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:02.000Z',
      counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
      deterministicFailure: false
    });
    expect(parseRunSummary(summary)).toEqual(summary);
  });
});

test.describe('writer', () => {
  test('ensureRunDir creates the run dir and report subdir', async () => {
    await withTempDir(async (tempDir) => {
      const runId = newRunId();
      await ensureRunDir(tempDir, runId);
      const runStat = await stat(runDir(tempDir, runId));
      expect(runStat.isDirectory()).toBe(true);
      const reportStat = await stat(path.join(runDir(tempDir, runId), 'report'));
      expect(reportStat.isDirectory()).toBe(true);
    });
  });

  test('ensureScenarioDir creates the scenario dir', async () => {
    await withTempDir(async (tempDir) => {
      const runId = newRunId();
      await ensureRunDir(tempDir, runId);
      await ensureScenarioDir(tempDir, runId, 'home-desktop-accepted-ES-ads');
      const scenarioStat = await stat(scenarioDir(tempDir, runId, 'home-desktop-accepted-ES-ads'));
      expect(scenarioStat.isDirectory()).toBe(true);
    });
  });

  test('writeManifest/writeSummary round-trip through parseRunManifest/parseRunSummary', async () => {
    await withTempDir(async (tempDir) => {
      const runId = newRunId();
      await ensureRunDir(tempDir, runId);

      const manifest = buildRunManifest({
        os: 'darwin arm64',
        browser: { name: 'chromium', version: '120.0' },
        config: validConfig(),
        scenarioIds: ['home-desktop-accepted-ES-ads']
      });
      const manifestWrittenPath = await writeManifest(tempDir, runId, manifest);
      expect(manifestWrittenPath).toBe(manifestPath(tempDir, runId));

      const summary = buildRunSummary({
        runId,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:02.000Z',
        counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
        deterministicFailure: false
      });
      const summaryWrittenPath = await writeSummary(tempDir, runId, summary);
      expect(summaryWrittenPath).toBe(summaryPath(tempDir, runId));

      const readManifest = parseRunManifest(JSON.parse(await readFile(manifestWrittenPath, 'utf8')));
      expect(readManifest).toEqual(manifest);

      const readSummary = parseRunSummary(JSON.parse(await readFile(summaryWrittenPath, 'utf8')));
      expect(readSummary).toEqual(summary);
    });
  });

  test('nothing is written outside outputDir', async () => {
    await withTempDir(async (tempDir) => {
      const runId = newRunId();
      const outputDir = path.join(tempDir, 'reports');
      await ensureRunDir(outputDir, runId);

      const manifest = buildRunManifest({
        os: 'darwin arm64',
        browser: { name: 'chromium', version: '120.0' },
        config: validConfig(),
        scenarioIds: []
      });
      await writeManifest(outputDir, runId, manifest);

      const summary = buildRunSummary({
        runId,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:02.000Z',
        counts: { passed: 0, failed: 0, skipped: 0, total: 0 },
        deterministicFailure: false
      });
      await writeSummary(outputDir, runId, summary);

      const topLevelEntries = await readdir(tempDir);
      expect(topLevelEntries).toEqual(['reports']);
    });
  });

  test('writing is idempotent (writing twice yields the same file content)', async () => {
    await withTempDir(async (tempDir) => {
      const runId = newRunId();
      await ensureRunDir(tempDir, runId);
      const manifest = buildRunManifest({
        os: 'darwin arm64',
        browser: { name: 'chromium', version: '120.0' },
        config: validConfig(),
        scenarioIds: []
      });

      await writeManifest(tempDir, runId, manifest);
      const first = await readFile(manifestPath(tempDir, runId), 'utf8');
      await writeManifest(tempDir, runId, manifest);
      const second = await readFile(manifestPath(tempDir, runId), 'utf8');

      expect(first).toBe(second);
    });
  });
});
