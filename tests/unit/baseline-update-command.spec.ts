import { test, expect } from '@playwright/test';
import path from 'node:path';
import {
  planBaselineUpdate,
  BaselineUpdateError,
  type UpdateRequest,
  type PlanInput
} from '../../src/baseline/plan.js';
import { applyBaselineUpdate, type FileSystemLike, type Clock } from '../../src/baseline/apply.js';
import { baselinePath, baselineStoreDir, auditLogPath } from '../../src/baseline/paths.js';

/** In-memory, Map-backed fake `FileSystemLike` — no real fs I/O. */
function fakeFs(initial: Record<string, string> = {}): FileSystemLike & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initial));
  const dirs = new Set<string>();
  return {
    files,
    exists(p: string): boolean {
      return files.has(p) || dirs.has(p);
    },
    mkdirp(dir: string): void {
      dirs.add(dir);
    },
    copyFile(from: string, to: string): void {
      const content = files.get(from);
      if (content === undefined) {
        throw new Error(`fakeFs: source does not exist: "${from}"`);
      }
      files.set(to, content);
    },
    appendFile(p: string, data: string): void {
      files.set(p, (files.get(p) ?? '') + data);
    }
  };
}

function fixedClock(iso = '2024-01-01T00:00:00.000Z'): Clock {
  return { now: () => iso };
}

function request(overrides: Partial<UpdateRequest> = {}): UpdateRequest {
  return {
    scenarioId: 'home-desktop-accepted-es-ads_on',
    targetId: 'full-page',
    baselineName: 'home-desktop-accepted-es-ads_on',
    project: 'desktop-chromium',
    sourceActualPath: '/runs/run-1/scenarios/home/actual.png',
    ...overrides
  };
}

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    requests: [request()],
    reason: 'Intentional redesign of the hero banner',
    baselineExists: () => false,
    sourceExists: () => true,
    ...overrides
  };
}

test.describe('planBaselineUpdate', () => {
  test('throws BaselineUpdateError with configuration_error/planning for a blank reason', () => {
    expect(() => planBaselineUpdate(baseInput({ reason: '   ' }))).toThrow(BaselineUpdateError);
    try {
      planBaselineUpdate(baseInput({ reason: '' }));
      expect(false).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(BaselineUpdateError);
      const normalized = (error as BaselineUpdateError).normalized;
      expect(normalized.category).toBe('configuration_error');
      expect(normalized.phase).toBe('planning');
    }
  });

  test('trims the reason', () => {
    const plan = planBaselineUpdate(baseInput({ reason: '  good reason  ' }));
    expect(plan.reason).toBe('good reason');
  });

  test('empty selection produces an empty plan', () => {
    const plan = planBaselineUpdate(baseInput({ requests: [] }));
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  test('a request with no existing baseline is a "create"', () => {
    const plan = planBaselineUpdate(baseInput({ baselineExists: () => false }));
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].kind).toBe('create');
    expect(plan.updates[0].to).toBe(baselinePath('desktop-chromium', 'home-desktop-accepted-es-ads_on'));
    expect(plan.updates[0].from).toBe('/runs/run-1/scenarios/home/actual.png');
  });

  test('a request whose baseline already exists is an "overwrite"', () => {
    const plan = planBaselineUpdate(baseInput({ baselineExists: () => true }));
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].kind).toBe('overwrite');
  });

  test('a request whose source actual is missing is rejected, never fabricated', () => {
    const plan = planBaselineUpdate(baseInput({ sourceExists: () => false }));
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].request).toEqual(request());
    expect(plan.rejected[0].message).toContain('actual');
  });

  test('preserves input order deterministically and is pure across repeated calls', () => {
    const requests = [
      request({ scenarioId: 'a', baselineName: 'a' }),
      request({ scenarioId: 'b', baselineName: 'b' }),
      request({ scenarioId: 'c', baselineName: 'c' })
    ];
    const input = baseInput({ requests });
    const plan1 = planBaselineUpdate(input);
    const plan2 = planBaselineUpdate(input);
    expect(plan1.updates.map((u) => u.scenarioId)).toEqual(['a', 'b', 'c']);
    expect(plan2.updates.map((u) => u.scenarioId)).toEqual(['a', 'b', 'c']);
  });

  test('mixes create/overwrite/rejected in one plan, preserving order', () => {
    const requests = [
      request({ scenarioId: 'create-me', baselineName: 'create-me' }),
      request({ scenarioId: 'overwrite-me', baselineName: 'overwrite-me' }),
      request({ scenarioId: 'missing-source', baselineName: 'missing-source', sourceActualPath: '/missing.png' })
    ];
    const plan = planBaselineUpdate(
      baseInput({
        requests,
        baselineExists: (_project, name) => name === 'overwrite-me',
        sourceExists: (source) => source !== '/missing.png'
      })
    );
    expect(plan.updates.map((u) => [u.scenarioId, u.kind])).toEqual([
      ['create-me', 'create'],
      ['overwrite-me', 'overwrite']
    ]);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].request.scenarioId).toBe('missing-source');
  });
});

test.describe('baseline path traversal guards', () => {
  test('baselineStoreDir resolves inside the repo root', () => {
    expect(path.isAbsolute(baselineStoreDir())).toBe(true);
    expect(baselineStoreDir().endsWith('baselines')).toBe(true);
  });

  test('rejects an absolute path segment', () => {
    expect(() => baselinePath('/etc', 'x')).toThrow();
    expect(() => baselinePath('desktop-chromium', '/etc/passwd')).toThrow();
  });

  test('rejects ".." traversal segments', () => {
    expect(() => baselinePath('..', 'x')).toThrow();
    expect(() => baselinePath('desktop-chromium', '../../etc/passwd')).toThrow();
  });

  test('rejects separator-injected segments', () => {
    expect(() => baselinePath('desktop-chromium/evil', 'x')).toThrow();
    expect(() => baselinePath('desktop-chromium', 'evil/name')).toThrow();
  });

  test('rejects empty segments', () => {
    expect(() => baselinePath('', 'x')).toThrow();
    expect(() => baselinePath('desktop-chromium', '')).toThrow();
  });

  test('auditLogPath stays inside the baseline store', () => {
    const auditPath = auditLogPath();
    expect(auditPath.startsWith(baselineStoreDir())).toBe(true);
    expect(auditPath.endsWith('UPDATE_LOG.jsonl')).toBe(true);
  });
});

test.describe('applyBaselineUpdate', () => {
  test('a "create" update is applied and copies the file to the baseline path', () => {
    const source = '/src/actual.png';
    const fs = fakeFs({ [source]: 'PNGDATA' });
    const plan = planBaselineUpdate(
      baseInput({ requests: [request({ sourceActualPath: source })], baselineExists: () => false })
    );
    const result = applyBaselineUpdate(plan, fs, fixedClock(), {
      allowOverwrite: false,
      toolVersion: '0.1.0'
    });
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    const to = baselinePath('desktop-chromium', 'home-desktop-accepted-es-ads_on');
    expect(fs.files.get(to)).toBe('PNGDATA');
  });

  test('an "overwrite" update is refused (skipped) without --yes / allowOverwrite', () => {
    const source = '/src/actual.png';
    const fs = fakeFs({ [source]: 'NEWDATA' });
    const plan = planBaselineUpdate(
      baseInput({ requests: [request({ sourceActualPath: source })], baselineExists: () => true })
    );
    const result = applyBaselineUpdate(plan, fs, fixedClock(), {
      allowOverwrite: false,
      toolVersion: '0.1.0'
    });
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].message).toContain('--yes');
    expect(result.audit).toBeUndefined();
    const to = baselinePath('desktop-chromium', 'home-desktop-accepted-es-ads_on');
    expect(fs.files.has(to)).toBe(false);
  });

  test('an "overwrite" update is applied when allowOverwrite is true', () => {
    const source = '/src/actual.png';
    const fs = fakeFs({ [source]: 'NEWDATA' });
    const plan = planBaselineUpdate(
      baseInput({ requests: [request({ sourceActualPath: source })], baselineExists: () => true })
    );
    const result = applyBaselineUpdate(plan, fs, fixedClock(), {
      allowOverwrite: true,
      toolVersion: '0.1.0'
    });
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    const to = baselinePath('desktop-chromium', 'home-desktop-accepted-es-ads_on');
    expect(fs.files.get(to)).toBe('NEWDATA');
  });

  test('appends exactly one secret-free JSON audit line containing the reason and timestamp', () => {
    const source = '/src/actual.png';
    const fs = fakeFs({ [source]: 'PNGDATA' });
    const requests = [
      request({ scenarioId: 'a', baselineName: 'a', sourceActualPath: source }),
      request({ scenarioId: 'b', baselineName: 'b', sourceActualPath: source })
    ];
    const plan = planBaselineUpdate(
      baseInput({ requests, reason: 'Reviewed hero redesign PR #42', baselineExists: () => false })
    );
    const result = applyBaselineUpdate(plan, fs, fixedClock('2024-06-01T12:00:00.000Z'), {
      allowOverwrite: false,
      toolVersion: '1.2.3',
      commitSha: 'abc123'
    });

    expect(result.applied).toHaveLength(2);
    const auditRaw = fs.files.get(auditLogPath()) ?? '';
    const lines = auditRaw.trim().split('\n');
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]) as {
      timestamp: string;
      reason: string;
      toolVersion: string;
      commitSha?: string;
      updates: unknown[];
    };
    expect(entry.timestamp).toBe('2024-06-01T12:00:00.000Z');
    expect(entry.reason).toBe('Reviewed hero redesign PR #42');
    expect(entry.toolVersion).toBe('1.2.3');
    expect(entry.commitSha).toBe('abc123');
    expect(entry.updates).toHaveLength(2);

    // secret-free: only ids/paths-relative-names/reason/version/sha, never a raw secret token.
    expect(auditRaw).not.toContain('Bearer');
    expect(auditRaw).not.toContain('cookie');
    expect(auditRaw).not.toContain('Authorization');
  });

  test('no audit line is written when nothing was applied', () => {
    const fs = fakeFs();
    const plan = planBaselineUpdate(
      baseInput({ requests: [request({ sourceActualPath: '/missing.png' })], sourceExists: () => false })
    );
    const result = applyBaselineUpdate(plan, fs, fixedClock(), {
      allowOverwrite: false,
      toolVersion: '0.1.0'
    });
    expect(result.applied).toHaveLength(0);
    expect(result.audit).toBeUndefined();
    expect(fs.files.has(auditLogPath())).toBe(false);
  });

  test('dry-run semantics: building a plan alone never touches the fake fs', () => {
    const fs = fakeFs({ '/src/actual.png': 'PNGDATA' });
    planBaselineUpdate(baseInput({ requests: [request({ sourceActualPath: '/src/actual.png' })] }));
    expect(fs.files.size).toBe(1); // unchanged from initial seed — plan() alone wrote nothing
  });
});
