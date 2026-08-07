#!/usr/bin/env node
// Recursively find *.test.ts under src/ and modules/ and hand them to
// node:test as positional arguments. This avoids depending on shell
// globstar (which is unavailable in /bin/sh on macOS).
//
// Also wires a small ESM loader hook that stubs `react-native` so unit
// tests can import from files that pull in `react-native` for unrelated
// side effects (e.g. AppState subscription). The stub is ONLY used at
// test time; production builds are unaffected.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = process.cwd();

/**
 * Walk `root` and collect every file path that matches the predicate.
 * Skips node_modules, .git, .gradle, build, dist, ios, android caches.
 */
function walk(root, predicate, results = []) {
  if (!existsSync(root)) return results;
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'build' || entry === 'dist' || entry === '.gradle' || entry === '.kotlin' || entry === '.cxx' || entry === '.expo') {
        continue;
      }
      walk(full, predicate, results);
    } else if (predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

const isTestFile = (p) => p.endsWith('.test.ts') || p.endsWith('.test.mts');

const roots = ['src', 'modules'];
const files = roots.flatMap((r) => walk(join(projectRoot, r), isTestFile));

if (files.length === 0) {
  console.error('No test files found under src/ or modules/.');
  process.exit(1);
}

// Build the args node --test will receive.
files.sort();
const loaderHook = fileURLToPath(new URL('./registerReactNative.mjs', import.meta.url));
const args = [
  '--import', 'tsx',
  '--import', `./${relative(projectRoot, loaderHook)}`,
  '--test',
  ...files.map((f) => relative(projectRoot, f)),
];

// Use a deterministic timezone so tests that format local times are
// reproducible across developer machines and CI. The production app
// picks up the device timezone at runtime; this only affects the test
// process environment.
const testEnv = { ...process.env, TZ: 'UTC' };

const result = spawnSync(process.execPath, args, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: testEnv,
});

process.exit(result.status ?? 1);