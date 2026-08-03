#!/usr/bin/env node
// Appends ONE secret-free audit line to baselines/UPDATE_LOG.jsonl for the
// baseline PNGs that changed in the working tree (added/modified/renamed under
// baselines/). Used by .github/workflows/update-baselines.yml so every CI
// baseline regeneration is recorded with a written reason before its PR is
// opened for human review. Records only file paths — never the QA target, a
// secret, or any page content.
//
// Usage: node scripts/log-baseline-update.mjs --reason "why" [--projects "a,b"]

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const reason = arg('reason');
if (!reason || !reason.trim()) {
  console.error('log-baseline-update: --reason is required and must be non-empty');
  process.exit(2);
}

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const logPath = path.join(repoRoot, 'baselines', 'UPDATE_LOG.jsonl');

// Discover changed baseline PNGs from git's porcelain status (staged or not).
const status = execFileSync('git', ['status', '--porcelain', '--', 'baselines'], {
  cwd: repoRoot,
  encoding: 'utf8'
});

const changed = status
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    // Porcelain: "XY path" or "XY old -> new" for renames.
    const rest = line.slice(2).trim();
    const file = rest.includes(' -> ') ? rest.split(' -> ').pop() : rest;
    return file;
  })
  .filter((file) => file && file.endsWith('.png'))
  // Strip an optional surrounding quote git adds for paths with special chars.
  .map((file) => file.replace(/^"|"$/g, ''));

if (changed.length === 0) {
  console.log('log-baseline-update: no baseline PNG changes detected; nothing to log.');
  process.exit(0);
}

const version = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;

const audit = {
  timestamp: new Date().toISOString(),
  reason: reason.trim(),
  toolVersion: version,
  ...(process.env.GITHUB_SHA ? { commitSha: process.env.GITHUB_SHA } : {}),
  source: 'ci:update-baselines',
  updates: changed.map((file) => ({ baselineFile: file, kind: 'update' }))
};

appendFileSync(logPath, `${JSON.stringify(audit)}\n`);
console.log(`log-baseline-update: recorded ${changed.length} baseline change(s) in ${logPath}`);
