// Standalone login for the e2e workspace: saves storageState to ./auth.json
// (relative to this script's dir). Does NOT touch /opt/data/auth.json, which is
// Hermes' own credential store — overwriting it destroys Hermes credentials.
//
// Usage:
//   cd /opt/data/e2e && DISPLAY=:99 PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/.playwright node login.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Resolve 'playwright' from local node_modules first, fall back to the global
// install (this container keeps playwright global, no local node_modules).
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/usr/local/lib/node_modules/playwright');
}
const { chromium } = playwright;

import { existsSync, unlinkSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, 'auth.json');
const BASE = process.env.BASE_URL || 'https://test-workbench.chintx.com/';

const browser = await chromium.launch({
  headless: false,
  args: ['--no-sandbox', '--start-maximized'],
});

try {
  // Auth already valid? quick check
  if (existsSync(AUTH_FILE)) {
    const ctx = await browser.newContext({ storageState: AUTH_FILE, baseURL: BASE });
    const p = await ctx.newPage();
    await p.goto('/iotWeb/deviceManage', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(1500);
    const valid = !p.url().includes('/login');
    await ctx.close();
    if (valid) {
      console.log('auth.json already valid');
      process.exit(0);
    }
    console.log('auth.json stale, re-login');
  }

  try { unlinkSync(AUTH_FILE); } catch {}

  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  console.log('→ opening login page');
  await page.goto('/infraWeb/login?redirectPath=/workbenchWeb', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  // switch to Chinese if on English UI
  const langEl = page.locator('text=English');
  if (await langEl.isVisible({ timeout: 3000 }).catch(() => false)) {
    await langEl.click();
    await page.locator('text=简体中文').click();
    await page.waitForTimeout(500);
  }

  await page.locator('input[placeholder="请输入用户名"]').fill('dyheyuan');
  await page.locator('input[placeholder="请输入密码"]').fill('Abc123456');
  await page.waitForTimeout(300);

  // slider captcha
  const slider = page.locator('.rc-slider-captcha-button');
  const box = await slider.boundingBox();
  if (!box) {
    await page.screenshot({ path: path.join(__dirname, 'login-fail.png') });
    throw new Error('滑块未找到');
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.waitForTimeout(100);
  await page.mouse.down();
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(startX + 490 * (i / 25), startY);
    await page.waitForTimeout(15 + Math.random() * 15);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  await page.locator('button').filter({ hasText: '登 录' }).click();
  await page.waitForTimeout(3000);

  // select space if prompted
  const combo = page.locator('[role="combobox"]').first();
  if (await combo.isVisible({ timeout: 3000 }).catch(() => false)) {
    await combo.click();
    await page.waitForTimeout(800);
    // dump real options + pick first whose text starts with 项目/
    const opts = await page.locator('.chint-select-item-option, [role="option"], .ant-select-item-option').allInnerTexts();
    const clean = opts.map((s) => s.trim()).filter(Boolean);
    console.log('→ space options:', JSON.stringify(clean));
    const pick = clean.find((s) => s.startsWith('项目/')) || clean[0];
    if (pick) {
      await page.locator(`text=${pick}`).first().click();
      console.log('→ picked space:', pick);
      await page.waitForTimeout(1000);
    }
  }

  // verify logged in
  const ok = await page.locator('text=个人信息').first().isVisible({ timeout: 10000 }).catch(() => false);
  if (!ok) {
    await page.screenshot({ path: path.join(__dirname, 'login-fail.png') });
    throw new Error('登录失败, URL=' + page.url());
  }

  await context.storageState({ path: AUTH_FILE });
  console.log('→ login OK, saved', AUTH_FILE);
  await context.close();
} finally {
  await browser.close();
}
