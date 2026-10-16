// E10.T4: גשר הודעות יזומות מהמרקטפלייס לבוט — ניתוב, fallback, ותיעוד סטטוסים
const { test } = require('node:test');
const assert = require('node:assert');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';
const { sendViaBot } = require('../src/notify');

function stubFetch(handler) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

test('not configured → no call, clear reason', async () => {
  delete process.env.BOT_OUTBOUND_URL; delete process.env.BOT_OUTBOUND_KEY;
  const calls = stubFetch(() => { throw new Error('must not be called'); });
  const r = await sendViaBot('+972500000002', 'שלום', 't');
  assert.strictEqual(r.sent, false);
  assert.strictEqual(r.reason, 'bot-not-configured');
  assert.strictEqual(calls.length, 0);
});

test('configured → POSTs to the bot with the key; simulated counts as handled', async () => {
  process.env.BOT_OUTBOUND_URL = 'https://bot.example/';
  process.env.BOT_OUTBOUND_KEY = 'k';
  const calls = stubFetch(async () => new Response(JSON.stringify({ status: 'simulated' }), { status: 200 }));
  const r = await sendViaBot('+972500000002', 'שלום', 'order_ready');
  assert.strictEqual(r.via, 'bot-simulated');
  assert.strictEqual(calls[0].url, 'https://bot.example/api/outbound/messages');
  assert.strictEqual(calls[0].init.headers['x-outbound-key'], 'k');
  const body = JSON.parse(calls[0].init.body);
  assert.deepStrictEqual(body, { to: '+972500000002', body: 'שלום', tag: 'order_ready' });
});

test('bot error → not sent with reason', async () => {
  const calls = stubFetch(async () => new Response(JSON.stringify({ error: 'bad key' }), { status: 401 }));
  const r = await sendViaBot('+972500000002', 'שלום', 't');
  assert.strictEqual(r.sent, false);
  assert.strictEqual(r.reason, 'bad key');
  assert.strictEqual(calls.length, 1);
});
