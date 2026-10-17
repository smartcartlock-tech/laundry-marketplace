// e2e לתפקידים: שליח, אדמין, ולקוח שמבטל הזמנה — כולל רענון סטטוס ברשימה.
const { test, expect } = require('@playwright/test');

async function apiLogin(request, phone, name) {
  const req = await request.post('/api/auth/otp/request', { data: { target: phone } });
  const { demoCode } = await req.json();
  const ver = await request.post('/api/auth/otp/verify', { data: { target: phone, code: demoCode, name } });
  const body = await ver.json();
  // C4: שער הסכמה בצ'ק-אאוט ראשון — ב-e2e מאשרים מרכזית אחרי ההתחברות
  await request.post('/api/auth/consent', { headers: { authorization: 'Bearer ' + body.token } });
  return { token: body.token, user: body.user };
}

async function enterAs(page, { token, user }, hash) {
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('wlm_token', JSON.stringify(t));
    localStorage.setItem('wlm_me', JSON.stringify(u));
  }, [token, user]);
  await page.goto('/' + hash);
}

test('שליח: מסך משימות נטען עם מסלול והצעות', async ({ page, request }) => {
  const auth = await apiLogin(request, '+972500000004');
  await enterAs(page, auth, '#/courier');
  await expect(page.getByText('מסלול פעיל')).toBeVisible();
  await expect(page.getByText(/שליח מכבסה ·/)).toBeVisible();
  await expect(page.locator('a.chip', { hasText: 'רווחים' })).toBeVisible();
});

test('אדמין: תמונת מצב + רשימת מכבסות', async ({ page, request }) => {
  const auth = await apiLogin(request, '+972500000001');
  await enterAs(page, auth, '#/admin');
  await expect(page.getByText('תמונת מצב')).toBeVisible();
  await page.goto('/#/admin/tenants');
  await expect(page.getByText('מכבסת האחוזה')).toBeVisible();
});

test('לקוח מבטל הזמנה — הרשימה מציגה בוטלה מיד אחר כך', async ({ page, request }) => {
  const auth = await apiLogin(request, '+972500000101', 'בדיקת ביטול');
  const laundry = await (await request.get('/api/laundries/achuza')).json();
  const bag = laundry.items.find(i => i.name.includes('שק'));
  const created = await request.post('/api/orders', {
    headers: { authorization: 'Bearer ' + auth.token },
    data: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'רחוב בדיקה 2, תל אביב' },
  });
  expect(created.status()).toBe(201);
  const orderId = (await created.json()).order.id;

  await enterAs(page, auth, '#/orders/' + orderId);
  await expect(page.getByText('התקבלה').first()).toBeVisible();

  // ביטול דרך ה-UI (כפתור + מודאל אישור)
  await page.getByRole('button', { name: 'ביטול הזמנה' }).click();
  await page.locator('#xm-ok').click();
  await expect(page.getByText('בוטלה').first()).toBeVisible();

  // חזרה לרשימה — הסטטוס חייב להיות מעודכן, לא מטמון ישן
  await page.goto('/#/orders');
  // ההזמנה המבוטלת מקובצת תחת "הזמנות שבוטלו" — פותחים ובודקים את הכרטיס הספציפי לפי מזהה (לא .first() כללי)
  await page.locator('details summary', { hasText: 'הזמנות שבוטלו' }).click();
  const row = page.locator(`.lcard[data-a="#/orders/${orderId}"]`);
  await expect(row.locator('.st-pill')).toContainText('בוטלה');
});
