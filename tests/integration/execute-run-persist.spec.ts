import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseRunResult, parseRunManifest, parseRunSummary, parseScenarioResult } from '../../src/domain/index.js';
import { executeRun } from '../../src/orchestrator/run.js';
import { manifestPath, scenarioResultPath, summaryPath } from '../../src/artifacts/paths.js';
import type { ProjectConfig } from '../../src/config/schema.js';

/**
 * Exercises `executeRun` with an injected fake `runSuite` (so no real
 * browser/Playwright process is spawned) but the REAL fs writers against an
 * `mkdtemp` output dir. See docs/features/execution-run-contract/SPEC.md.
 */

function baseConfig(outputDir: string): ProjectConfig {
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
    artifacts: { outputDir, retainOnFailureOnly: true },
    ai: { enabled: false, provider: 'none', timeoutMs: 30_000, maxOutputTokens: 1024, maxAttempts: 2, maxCostUsd: 0.5 },
    execution: { retries: 0 }
  } as ProjectConfig;
}

const SCENARIOS = [
  {
    id: 'home-desktop-accepted-ES-ads',
    page: { path: '/' },
    device: 'desktop' as const,
    consent: 'accepted' as const,
    country: 'ES',
    adsEnabled: true
  },
  {
    id: 'home-mobile-rejected-ES-noads',
    page: { path: '/' },
    device: 'mobile' as const,
    consent: 'rejected' as const,
    country: 'ES',
    adsEnabled: false
  }
];

const FAKE_REPORT = {
  suites: [
    {
      specs: [
        {
          title: 'home-desktop-accepted-ES-ads',
          tests: [
            {
              results: [
                {
                  status: 'passed',
                  duration: 1500,
                  startTime: '2026-02-01T09:00:00.000Z',
                  errors: []
                }
              ]
            }
          ]
        },
        {
          title: 'home-mobile-rejected-ES-noads',
          tests: [
            {
              results: [
                {
                  status: 'failed',
                  duration: 800,
                  startTime: '2026-02-01T09:00:01.500Z',
                  errors: [{ message: 'Screenshot comparison failed for baseline.png' }]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};

test.describe('executeRun persistence', () => {
  test('persists manifest.json, summary.json and per-scenario result.json against real writers', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hola-execute-run-'));
    try {
      const config = baseConfig(path.join(tempDir, 'reports'));
      const startedAt = new Date('2026-02-01T09:00:00.000Z');
      const finishedAt = new Date('2026-02-01T09:00:05.000Z');
      let callCount = 0;

      const runResult = await executeRun(
        { config, scenarios: SCENARIOS, updateSnapshots: false },
        {
          now: () => (callCount++ === 0 ? startedAt : finishedAt),
          generateRunId: () => '20260201T090000Z-abc123',
          runSuite: async () => FAKE_REPORT,
          resolveBrowserInfo: () => ({ name: 'chromium', version: '1.62.1' })
        }
      );

      // The returned RunResult is schema-valid with correct counts/failure.
      expect(() => parseRunResult(runResult)).not.toThrow();
      expect(runResult.counts).toEqual({ passed: 1, failed: 1, skipped: 0, total: 2 });
      expect(runResult.deterministicFailure).toBe(true);
      expect(runResult.runId).toBe('20260201T090000Z-abc123');

      const outputDir = config.artifacts.outputDir;
      const runId = runResult.runId;

      // manifest.json
      const manifestRaw = JSON.parse(await readFile(manifestPath(outputDir, runId), 'utf8'));
      const manifest = parseRunManifest(manifestRaw);
      expect(manifest.scenarioIds).toEqual(SCENARIOS.map((s) => s.id));

      // summary.json
      const summaryRaw = JSON.parse(await readFile(summaryPath(outputDir, runId), 'utf8'));
      const summary = parseRunSummary(summaryRaw);
      expect(summary.counts).toEqual({ passed: 1, failed: 1, skipped: 0, total: 2 });
      expect(summary.deterministicFailure).toBe(true);

      // scenarios/<id>/result.json for each scenario
      for (const scenario of SCENARIOS) {
        const resultRaw = JSON.parse(await readFile(scenarioResultPath(outputDir, runId, scenario.id), 'utf8'));
        const scenarioResult = parseScenarioResult(resultRaw);
        expect(scenarioResult.scenario.id).toBe(scenario.id);
      }

      // No secret-shaped fields or absolute paths in any persisted file.
      const allFiles = [
        manifestPath(outputDir, runId),
        summaryPath(outputDir, runId),
        ...SCENARIOS.map((s) => scenarioResultPath(outputDir, runId, s.id))
      ];
      for (const file of allFiles) {
        const contents = await readFile(file, 'utf8');
        const lower = contents.toLowerCase();
        for (const secretWord of ['apikey', 'api_key', 'authorization', 'cookie', 'password', 'secret', 'token']) {
          expect(lower).not.toContain(secretWord);
        }
        expect(contents).not.toContain(tempDir);
      }

      const scenarioDirEntries = await readdir(path.join(outputDir, runId, 'scenarios'));
      expect(scenarioDirEntries.sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
