// זרימת לקוח מלאה דרך הדפדפן: סל → כניסה ב-OTP דמו → צ'קאאוט → מעקב הזמנה.
const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

test('הזמנה מלאה: הוספה לסל, התחברות OTP דמו, אישור הזמנה ומעקב', async ({ page }) => {
  // 1. דף מכבסה — הוספת שק כביסה לסל
  await page.goto('/#/laundry/achuza');
  const bagRow = page.locator('.row', { hasText: 'שק כביסה' }).first();
  await bagRow.locator('button', { hasText: 'הוספה' }).click();
  await expect(page.locator('button', { hasText: /להזמנה · סל/ })).toBeVisible();

  // 2. מעבר לצ'קאאוט — מפנה להתחברות כי לא מחוברים
  await page.locator('button', { hasText: /להזמנה · סל/ }).click();
  await expect(page.locator('#login-target')).toBeVisible();
  await expect(page.getByText('הסל שלך שמור')).toBeVisible();

  // 3. התחברות OTP דמו
  await page.fill('#login-target', '+972500000002');
  await page.locator('button', { hasText: 'שלחו לי קוד כניסה' }).click();
  const codeEl = page.locator('.warn b');
  await expect(codeEl).toBeVisible();
  const code = (await codeEl.textContent()).trim();
  expect(code).toMatch(/^\d{6}$/);
  await page.fill('#login-code', code);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();

  // 4. חזרה אוטומטית לצ'קאאוט — מילוי כתובת ואישור
  await expect(page.locator('#co-address')).toBeVisible();
  await page.fill('#co-address', 'רחוב בדיקה 1, תל אביב');
  // C4: שער הסכמה — אם נטען הצ'קבוקס, מאשרים לפני השליחה
  const consent = page.locator('#co-consent');
  if (await consent.count()) await consent.check();
  await page.locator('#co-submit').click();

  // 5. דף מעקב הזמנה — סטטוס "התקבלה"
  await expect(page).toHaveURL(/#\/orders\/[0-9a-f-]+/);
  await expect(page.getByText('התקבלה').first()).toBeVisible();

  // 6. רשימת ההזמנות כוללת את ההזמנה החדשה
  await page.goto('/#/orders');
  await expect(page.locator('.lcard').first()).toBeVisible();
  await expect(page.getByText('מכבסת האחוזה').first()).toBeVisible();
});

test('התנתקות מחזירה למסך בית', async ({ page }) => {
  await page.goto('/#/login');
  await page.fill('#login-target', '+972500000100');
  await page.locator('button', { hasText: 'שלחו לי קוד כניסה' }).click();
  const codeEl = page.locator('.warn b');
  await expect(codeEl).toBeVisible();
  await page.fill('#login-code', (await codeEl.textContent()).trim());
  await page.fill('#login-name', 'בדיקת התנתקות');
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page.getByText('מחובר כ')).toBeVisible();
  await page.getByText('התנתקות').click();
  await expect(page.getByText('מחובר כ')).toHaveCount(0);
});
