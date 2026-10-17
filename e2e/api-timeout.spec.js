// T1: קריאת API תקועה לא משאירה "טוען…" לנצח — אחרי timeout המסך מתרנדר (שגיאה/אופליין)
const { test, expect } = require('@playwright/test');

test('API תקוע: הבית יוצא מ"טוען…" תוך 30 שניות', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/api/laundries**', () => {}); // לעולם לא עונה — מדמה שרת תקוע
  await page.goto('/#/');
  await expect(page.locator('#app')).toContainText('טוען');
  // לפני התיקון: נתקע כאן לנצח. אחרי התיקון: timeout של 20 שנ' מפיל לנתיב שגיאה/אופליין
  await expect(page.locator('#app')).not.toContainText('טוען…', { timeout: 30000 });
  await expect(page.locator('#app')).toContainText('מכבסה בקליק');
});
