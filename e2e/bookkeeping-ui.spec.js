const { test, expect } = require('@playwright/test');

test('T3/T55/T30 demo bookkeeping: supplier inline, balanced entry, reversal, mobile width', async ({page, request}) => {
  const req = await request.post('/api/auth/otp/request', {data:{target:'+972500000003'}});
  const otp = await req.json();
  const res = await request.post('/api/auth/otp/verify', {data:{target:'+972500000003',code:otp.demoCode}});
  const auth = await res.json();
  const init=await request.post('/api/t/achuza/bookkeeping/init',{headers:{authorization:'Bearer '+auth.token}});
  expect(init.ok()).toBeTruthy();
  await page.addInitScript(([token, user]) => {
    localStorage.setItem('wlm_token',JSON.stringify(token));
    localStorage.setItem('wlm_me',JSON.stringify(user));
  },[auth.token,auth.user]);
  await page.goto('/#/manage/bookkeeping');
  await expect(page.locator('#bk-journal-card')).toBeVisible();
  for (const width of [375,390,1280]) {
    await page.setViewportSize({width,height:844});
    const metrics = await page.locator('#bk-exp-desc').evaluate(el => ({width:el.getBoundingClientRect().width,body:document.documentElement.scrollWidth,viewport:innerWidth}));
    expect(metrics.body).toBeLessThanOrEqual(metrics.viewport+1);
    expect(metrics.width).toBeGreaterThan(width < 600 ? 250 : 100);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#bk-exp-desc').fill('טיוטת הוצאה נשמרת');
  await page.locator('[data-bkp-act="sup-toggle"]').click();
  const name = 'ספק דמו UI '+Date.now();
  await page.locator('#bk-ns-name').fill(name);
  await page.locator('[data-bkp-act="sup-create"]').click();
  await expect(page.locator('#bk-exp-sup option:checked')).toHaveText(name);
  await expect(page.locator('#bk-exp-desc')).toHaveValue('טיוטת הוצאה נשמרת');
  await page.locator('#bk-journal-card > details > summary').click();
  const desc = 'מסמך דמו UI '+Date.now();
  await page.locator('#bk-j-desc').fill(desc);
  await page.locator('.bk-j-line').nth(0).locator('.bk-j-acc').selectOption('1010');
  await page.locator('.bk-j-line').nth(0).locator('.bk-j-debit').fill('5');
  await page.locator('.bk-j-line').nth(1).locator('.bk-j-acc').selectOption('4000');
  await page.locator('.bk-j-line').nth(1).locator('.bk-j-credit').fill('5');
  await page.locator('[data-bkj-act="submit-entry"]').click();
  const row=page.locator('.bk-j-row').filter({hasText:desc});
  await expect(row).toBeVisible();
  await row.locator('summary').click();
  await expect(row.locator('table')).toContainText('1010');
  await row.locator('[data-bkj-act="reverse"]').click();
  await page.locator('#xm-ok').click();
  await expect(page.locator('.bk-j-row').filter({has:page.locator('summary',{hasText:desc})}).first()).toBeVisible();
  await expect(page.locator('.bk-j-row').filter({hasText:desc})).toHaveCount(2);
  await page.locator('#bk-j-from').fill('2025-01-01');
  await page.locator('#bk-j-to').fill('2025-01-31');
  await page.locator('[data-bkj-act="filter"]').click();
  await expect(page.locator('#bk-j-from')).toHaveValue('2025-01-01');
  await expect(page.locator('.bk-j-row').filter({hasText:desc})).toHaveCount(0);
});
