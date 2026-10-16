// בדיקות עשן e2e: טעינת דפים מרכזיים, RTL, ניווט, חיפוש, SEO ובריאות API.
const { test, expect } = require('@playwright/test');

test('דף הבית נטען בעברית RTL ומציג מכבסות', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/מכבסה בקליק/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.lcard')).toHaveCount(4);
  await expect(page.getByText('מכבסת האחוזה')).toBeVisible();
  await expect(page.getByText('מכבסת הכרמל')).toBeVisible();
});

test('ניווט לדף מכבסה ומחירון חי', async ({ page }) => {
  await page.goto('/');
  await page.getByText('מכבסת האחוזה').click();
  await expect(page).toHaveURL(/#\/laundry\/achuza/);
  await expect(page.locator('h2')).toContainText('מכבסת האחוזה');
  await expect(page.getByText('שק כביסה (עד 8 ק״ג)')).toBeVisible();
  await expect(page.locator('button', { hasText: 'הוספה' }).first()).toBeVisible();
});

test('חיפוש מסנן לפי עיר', async ({ page }) => {
  await page.goto('/');
  await page.fill('#q', 'חיפה');
  await page.press('#q', 'Enter');
  await expect(page.locator('.lcard')).toHaveCount(1);
  await expect(page.getByText('מכבסת הכרמל')).toBeVisible();
});

test('דף SEO לעיר מוחזר מהשרת', async ({ request }) => {
  const ok = await request.get('/area/' + encodeURIComponent('תל אביב'));
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toContain('מכבסה');
  const missing = await request.get('/area/' + encodeURIComponent('עיר שלא קיימת'));
  expect(missing.status()).toBe(404);
});

test('בריאות ו-API ציבורי', async ({ request }) => {
  const h = await request.get('/health');
  expect(h.ok()).toBeTruthy();
  const l = await request.get('/api/laundries');
  expect(l.ok()).toBeTruthy();
  const body = await l.json();
  expect(body.laundries.map(x => x.slug)).toContain('achuza');
});
