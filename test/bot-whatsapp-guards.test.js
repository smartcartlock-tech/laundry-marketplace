// QA review: whatsapp/bot send guards. No network: fetch and twilio are stubbed. Demo data only.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const twilioCalls = [];
const orig = Module._load;
Module._load = function (req, parent, ...r) {
  if (req === './db' || req.endsWith('/db')) return { q: async () => ({ rows: [] }) };
  if (req === './push') return { sendPushToUser: async () => ({ sent: 0 }) };
  if (req === 'twilio') return () => ({ messages: { create: async (m) => { twilioCalls.push(m); return {}; } } });
  return orig.call(this, req, parent, ...r);
};
process.env.BOT_OUTBOUND_URL = 'http://bot.invalid';
process.env.BOT_OUTBOUND_KEY = 'k';
process.env.TWILIO_ACCOUNT_SID = 'ACdemo'; process.env.TWILIO_AUTH_TOKEN = 't';
process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+10000000000';
const { sendWhatsApp, notifyUser } = require('../src/notify');

test('F1: bot rejects non-allowlisted number -> must NOT fall through to direct Twilio', async () => {
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'not-allowlisted' }) });
  twilioCalls.length = 0;
  const r = await sendWhatsApp('+972500000099', 'demo');
  assert.strictEqual(twilioCalls.length, 0, 'direct Twilio send happened after the bot refused: ' + JSON.stringify(twilioCalls));
});

test('F2: bot unreachable -> must not fall through to direct Twilio', async () => {
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  twilioCalls.length = 0;
  await sendWhatsApp('+972500000099', 'demo');
  assert.strictEqual(twilioCalls.length, 0);
});

test('F3: sendViaBot has a timeout (fetch call carries a signal)', async () => {
  let opts; global.fetch = async (u, o) => { opts = o; return { ok: true, json: async () => ({ status: 'simulated' }) }; };
  await sendWhatsApp('+972500000099', 'demo');
  assert.ok(opts && opts.signal, 'no AbortSignal/timeout on outbound fetch');
});

