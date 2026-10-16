// גיבוי מוצפן: יצירה, רשימה, הורדה, ובדיקת שחזור (פענוח+אימות תוכן); שיבוש נכשל
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';
process.env.BACKUP_KEY = process.env.BACKUP_KEY || Buffer.from('fedcba9876543210fedcba9876543210').toString('base64');

test('גיבוי מוצפן: יצירה → רשימה → שחזור-בדיקה; זר נדחה', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');

  const made = await api('/api/admin/backup/encrypted', { method: 'POST', token: admin });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.ok(made.json.meta.tables > 10);

  const list = await api('/api/admin/backups', { token: admin });
  assert.equal(list.status, 200);
  const b = list.json.backups.find(x => x.id === made.json.id);
  assert.ok(b && b.size > 1000);

  const ver = await api(`/api/admin/backups/${made.json.id}/verify`, { method: 'POST', token: admin });
  assert.equal(ver.status, 200, JSON.stringify(ver.json));
  assert.ok(ver.json.ok);
  assert.ok(ver.json.counts.orders >= 0 && ver.json.counts.users >= 1, 'שחזור-בדיקה מחזיר טבלאות');

  // הורדה באוקטטים
  const dl = await api(`/api/admin/backups/${made.json.id}/download`, { token: admin });
  assert.equal(dl.status, 200);


  // לא-אדמין נדחה
  const cust = await api.login('+972500000922');
  assert.equal((await api('/api/admin/backups', { token: cust })).status, 403);
});

test('יחידה: הצפנת גיבוי round-trip; שיבוש בית אחד מכשיל פענוח (GCM)', () => {
  const { encryptBuffer, verifyBackup } = require('../src/backup-crypto');
  const payload = encryptBuffer(Buffer.from(JSON.stringify({ exported_at: 'x', tables: { users: [{ id: 1 }] } })));
  assert.deepEqual(verifyBackup(payload).counts, { users: 1 });
  const bad = Buffer.from(payload); bad[bad.length - 1] ^= 1;
  assert.throws(() => verifyBackup(bad), 'שיבוש בית אחד מכשיל פענוח');
});
