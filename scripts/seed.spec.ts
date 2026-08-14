// 脚手架种子测试:验证环境就绪(登录态 + 页面可达)
import { test, expect } from '@playwright/test';

test('seed: deviceManage page reachable', async ({ page }) => {
  await page.goto('/iotWeb/deviceManage', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  expect(page.url()).not.toContain('/login');
  await expect(page.locator('body')).toBeVisible();
});
