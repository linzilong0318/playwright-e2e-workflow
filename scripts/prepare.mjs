#!/usr/bin/env node
// Materialize template/ -> workspace root with container patches (idempotent).
// Behavior documented in the playwright-e2e-workflow skill:
//   - storageState -> absolute path (__dirname), CJS-transpile safe
//   - headless: true + --no-sandbox (container has no DISPLAY / sandbox limits)
//   - global-setup: AUTH_FILE injection + no-DISPLAY login guidance
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TPL = path.join(ROOT, 'template');

// Engineer files may use CR-only or CRLF line endings — normalize to LF.
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (p, c) => writeFileSync(p, c, 'utf8');
const patched = [];

// ---------- playwright.config.ts ----------
let cfg = read(path.join(TPL, 'playwright.config.ts'));
cfg = cfg.replace(
  `import { defineConfig } from '@playwright/test';`,
  `import { defineConfig } from '@playwright/test';\nimport * as path from 'path';\n\n// container patch: absolute paths must not depend on process cwd\nconst CONFIG_DIR = __dirname;`
);
cfg = cfg.replace(
  `export default defineConfig({`,
  `export default defineConfig({\n  testDir: '.',\n  outputDir: 'test-results',`
);
cfg = cfg.replace(`storageState: 'auth.json'`, `storageState: path.join(CONFIG_DIR, 'auth.json')`);
cfg = cfg.replace(`headless: false`, `headless: true`);
cfg = cfg.replace(`args: ['--start-maximized']`, `args: ['--start-maximized', '--no-sandbox']`);
cfg = cfg.replace(`outputFile: 'report/test-results.json'`, `outputFile: path.join(CONFIG_DIR, 'report/test-results.json')`);
// container patch: config may pin msedge/other browsers not installed here —
// drop any non-chromium browserName and any channel, use bundled chromium
cfg = cfg.replace(/\n\s*browserName: '(?!chromium)[^']*',?/g, '');
cfg = cfg.replace(/\n\s*channel: '[^']*',?/g, '');
// container patch: ensure json reporter exists (阶段5 报告依赖), 缺失才注入
if (!cfg.includes('reporter:')) {
  cfg = cfg.replace(
    `globalSetup: './global-setup',`,
    `globalSetup: './global-setup',\n  reporter: [\n    ['list'],\n    ['json', { outputFile: path.join(CONFIG_DIR, 'report/test-results.json') }],\n  ],`
  );
}
write(path.join(ROOT, 'playwright.config.ts'), cfg);
patched.push('playwright.config.ts');

// ---------- global-setup.ts ----------
let gs = read(path.join(TPL, 'global-setup.ts'));
gs = gs.replace(
  `import { chromium, FullConfig } from '@playwright/test';`,
  `import { chromium, FullConfig } from '@playwright/test';\nimport * as path from 'path';\n\n// container patch: absolute auth path (env-overridable), never cwd-relative\nconst AUTH_FILE = process.env.AUTH_FILE || path.join(__dirname, 'auth.json');`
);
gs = gs.replace(/existsSync\('auth\.json'\)/g, `existsSync(AUTH_FILE)`);
gs = gs.replace(/storageState: 'auth\.json'/g, `storageState: AUTH_FILE`);
gs = gs.replace(/unlinkSync\('auth\.json'\)/g, `unlinkSync(AUTH_FILE)`);
// container patch: no msedge/other browsers here — drop channel from launch calls
gs = gs.replace(/channel: '[^']*',?\s*/g, '');
gs = gs.replace(
  `const browser = await chromium.launch({ headless: false });`,
  `// container patch: headed login needs X; otherwise point to login.mjs\nif (!process.env.DISPLAY) {\n  console.error('[global-setup] auth invalid and no DISPLAY — run: DISPLAY=:99 node login.mjs');\n  process.exit(1);\n}\nconst browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });`
);
write(path.join(ROOT, 'global-setup.ts'), gs);
patched.push('global-setup.ts');

// ---------- assets ----------
if (existsSync(path.join(TPL, 'assets'))) {
  mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  cpSync(path.join(TPL, 'assets'), path.join(ROOT, 'assets'), { recursive: true });
  patched.push('assets/');
}

// ---------- node_modules links ----------
// No local install: link the global playwright packages so the config loader
// (resolves from config dir upward) and test files can import them. Keeps the
// exact version the CLI/MCP use — no browser-revision drift.
function linkNodeModules() {
  const nm = path.join(ROOT, 'node_modules');
  const links = [
    ['@playwright/test', '/usr/local/lib/node_modules/@playwright/test'],
    ['playwright', '/usr/local/lib/node_modules/playwright'],
    ['playwright-core', '/usr/local/lib/node_modules/playwright/node_modules/playwright-core'],
  ];
  for (const [name, target] of links) {
    if (!existsSync(target)) continue;
    const p = path.join(nm, name);
    if (!existsSync(p)) {
      mkdirSync(path.dirname(p), { recursive: true });
      symlinkSync(target, p, 'dir');
      console.log('linked node_modules/' + name);
    }
  }
}
linkNodeModules();

console.log('materialized:', patched.join(', '));
