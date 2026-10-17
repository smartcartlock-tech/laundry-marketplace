// T78: טוקן פג תוקף ב-boot — 401 מנקה טוקן, מציג התחברות ו-toast, לא תקוע על "טוען…"
const { test, expect } = require('@playwright/test');

test('טוקן פג ב-#/manage: ניקוי טוקן + מסך התחברות + toast', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wlm_token', JSON.stringify('expired-fake-token-123')));
  await page.goto('/#/manage');
  // מסך התחברות מוצג (לא "טוען…" תקוע)
  await expect(page.locator('#login-target')).toBeVisible();
  // הטוקן נוקה מהאחסון
  await expect.poll(() => page.evaluate(() => localStorage.getItem('wlm_token'))).toBeNull();
  // toast פקיעת חיבור
  await expect(page.locator('.toast')).toContainText('פג תוקף החיבור');
});

test('טוקן פג בדף הבית: ניקוי שקט בלי toast שגוי, האפליקציה מתפקדת', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wlm_token', JSON.stringify('expired-fake-token-123')));
  await page.goto('/#/');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('wlm_token'))).toBeNull();
  await expect(page.locator('#app')).toContainText('מכבסה בקליק');
});
