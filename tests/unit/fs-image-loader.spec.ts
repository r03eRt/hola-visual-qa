import { test, expect } from '@playwright/test';
import { FsImageLoader } from '../../src/ai/anthropic/fs-image-loader.js';

// These are hermetic: every ref here is rejected by the traversal guard
// BEFORE any filesystem access, so no real file is ever read.
test.describe('FsImageLoader path guard', () => {
  const loader = new FsImageLoader();

  test('rejects an absolute posix path without reading the filesystem', async () => {
    expect(await loader.load('/etc/passwd')).toBeNull();
  });

  test('rejects a windows-style absolute path', async () => {
    expect(await loader.load('C:\\Windows\\system32\\config')).toBeNull();
  });

  test('rejects a parent-directory traversal segment', async () => {
    expect(await loader.load('../../../../etc/passwd')).toBeNull();
  });

  test('rejects a traversal segment nested inside an otherwise relative path', async () => {
    expect(await loader.load('reports/run/../../secret.png')).toBeNull();
  });

  test('rejects a backslash-separated traversal segment', async () => {
    expect(await loader.load('reports\\..\\..\\secret.png')).toBeNull();
  });

  test('returns null for a missing but safe relative path (no throw)', async () => {
    expect(await loader.load('reports/does-not-exist-9f2c1a.png')).toBeNull();
  });
});
