// T1: שני טאבים על דף הבית — בלי לולאת רינדור (ping-pong של storage events)
const { test, expect } = require('@playwright/test');

test('שני טאבים מחוברים בדף הבית: routeSeq יציב', async ({ context, baseURL }) => {
  const rc = await (await context.request.post(baseURL + '/api/auth/otp/request', { data: { target: '+972500000002' } })).json();
  const vc = await (await context.request.post(baseURL + '/api/auth/otp/verify', { data: { target: '+972500000002', code: rc.demoCode } })).json();
  await context.addInitScript(t => localStorage.setItem('wlm_token', JSON.stringify(t)), vc.token);
  const p1 = await context.newPage();
  await p1.goto('/#/');
  await p1.waitForTimeout(3000);
  const p2 = await context.newPage();
  await p2.goto('/#/');
  await p2.waitForTimeout(2000);
  const a = await p1.evaluate(() => eval('routeSeq'));
  await p1.waitForTimeout(4000);
  const b = await p1.evaluate(() => eval('routeSeq'));
  expect(b - a, `routeSeq זינק מ-${a} ל-${b} — לולאת רינדור`).toBeLessThanOrEqual(1);
});
