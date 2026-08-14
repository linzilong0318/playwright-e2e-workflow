#!/usr/bin/env node
// Clean generated artifacts. Keeps templates/ template/ scripts/ login.mjs
// seed.spec.ts auth.json. --all also removes auth.json (storageState) and reports.
import { existsSync, rmSync, readdirSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const all = process.argv.includes('--all');

// Directories and files to remove (relative to e2e/)
const targets = [
  'tests',
  'specs',
  'report',
  'test-results',
  'playwright.config.ts',
  'global-setup.ts',
  'assets',
  'login-fail.png',
  'explore-*.png',
  'model-*.png',
  'before-submit.png',
  'final-submit.png',
];

// Also clean any loose .spec.ts files in e2e root (except seed.spec.ts)
const rootFiles = readdirSync(ROOT);
for (const f of rootFiles) {
  if (f.endsWith('.spec.ts') && f !== 'seed.spec.ts') {
    const p = path.join(ROOT, f);
    rmSync(p, { force: true });
    console.log('removed', f);
  }
}

for (const t of targets) {
  const p = path.join(ROOT, t);
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log('removed', t);
  }
}

if (all) {
  const authPath = path.join(ROOT, 'auth.json');
  if (existsSync(authPath)) {
    rmSync(authPath, { force: true });
    console.log('removed auth.json (--all)');
  }
}

console.log('cleanup done' + (all ? ' (--all)' : ''));
