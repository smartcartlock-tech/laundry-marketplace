// H3: ניקוי נתוני דמו מהפרוד לפני go-live. סקריפט ידני בלבד — לא רץ אוטומטית.
// מסיר את טננטי הדמו ומשתמשי הדמו (is_demo=true בלבד, מיגרציה 008) וכל הנתונים התלויים.
// G5: לעולם לא נוגע בנתונים שאינם דמו — טננט/משתמש בלי is_demo לא נמחק, והסקריפט
// נעצר לחלוטין אם משתמש דמו קשור לטננט שאינו דמו (מניעת יתומים, למשל מכבסה עם הנה"ח אמיתית).
// בטיחות: דורש CONFIRM_PURGE_DEMO=yes; רץ בטרנזקציה; מדפיס ספירות לפני מחיקה.
// חובה לפני הרצה: גיבוי מלא (scripts/backup.js). מומלץ: APP_MODE=pilot כבר מוגדר.
// הרצה: CONFIRM_PURGE_DEMO=yes DATABASE_URL=... node scripts/purge-demo.js
const { Pool } = require('pg');

if (process.env.CONFIRM_PURGE_DEMO !== 'yes') {
  console.error('בטיחות: יש להריץ עם CONFIRM_PURGE_DEMO=yes (ולקחת גיבוי קודם — scripts/backup.js)');
  process.exit(1);
}
const SCHEMA = process.env.PGSCHEMA || null; // סכימה מבודדת בבדיקות
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
  ...(SCHEMA ? { options: `-c search_path=${SCHEMA},public` } : {}),
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: tenants } = await client.query('SELECT id, slug FROM tenants WHERE is_demo');
    const tids = tenants.map(t => t.id);
    const { rows: users } = await client.query('SELECT id FROM users WHERE is_demo');
    const uids = users.map(u => u.id);
    console.log(`מכבסות דמו: ${tenants.map(t => t.slug).join(', ') || 'אין'} · משתמשי דמו: ${uids.length}`);
    if (!tids.length && !uids.length) { console.log('אין מה לנקות'); await client.query('ROLLBACK'); return; }

    // G5: הגנת הפרדה — משתמש דמו שקשור לטננט שאינו דמו (חברות, שליחות, הזמנה, מסמך)
    // פירושו שמחיקתו תשאיר נתונים אמיתיים יתומים. עוצרים הכל בלי למחוק דבר.
    if (uids.length) {
      const { rows: leaks } = await client.query(
        `SELECT u.phone, t.slug, x.rel FROM (
           SELECT tm.user_id AS uid, tm.tenant_id AS tid, 'חברות בצוות' AS rel FROM tenant_members tm
           UNION ALL SELECT c.user_id, c.tenant_id, 'שליח פרטי של' FROM couriers c WHERE c.tenant_id IS NOT NULL
           UNION ALL SELECT o.customer_id, o.tenant_id, 'הזמנה ב' FROM orders o
           UNION ALL SELECT cu.user_id, o.tenant_id, 'משלוח ב' FROM orders o JOIN couriers cu ON cu.id = o.courier_id
           UNION ALL SELECT d.customer_id, d.tenant_id, 'מסמך ב' FROM documents d
         ) x JOIN users u ON u.id = x.uid JOIN tenants t ON t.id = x.tid
         WHERE x.uid = ANY($1) AND NOT t.is_demo LIMIT 20`, [uids]);
      if (leaks.length) {
        await client.query('ROLLBACK');
        console.error('חסום: נמצאו משתמשי דמו הקשורים לטננטים שאינם דמו — לא נמחק דבר:');
        for (const l of leaks) console.error(`  ${l.phone} — ${l.rel} ${l.slug}`);
        console.error('יש לנתק את הקשרים ידנית או לסמן את הטננטים is_demo לפני הרצה חוזרת.');
        process.exitCode = 1;
        return;
      }
    }

    // מסמכים חשבונאיים חסומי-מחיקה בטריגר — מושבת זמנית בתוך הטרנזקציה ומוחזר מיד
    await client.query('ALTER TABLE documents DISABLE TRIGGER documents_immutable_trg');
    const del = async (label, sql, params) => {
      const r = await client.query(sql, params);
      console.log(`  נמחקו ${r.rowCount} × ${label}`);
    };
    if (tids.length) {
      const { rows: orders } = await client.query('SELECT id FROM orders WHERE tenant_id = ANY($1)', [tids]);
      const oids = orders.map(o => o.id);
      const { rows: docs } = await client.query('SELECT id FROM documents WHERE tenant_id = ANY($1)', [tids]);
      const dids = docs.map(d => d.id);
      if (dids.length) {
        await del('document_events', 'DELETE FROM document_events WHERE document_id = ANY($1)', [dids]);
        await del('document_orders', 'DELETE FROM document_orders WHERE document_id = ANY($1)', [dids]);
        await del('documents', 'DELETE FROM documents WHERE id = ANY($1)', [dids]);
      }
      if (oids.length) {
        await del('order_items', 'DELETE FROM order_items WHERE order_id = ANY($1)', [oids]);
        await del('order_events', 'DELETE FROM order_events WHERE order_id = ANY($1)', [oids]);
        await del('issue_photos', 'DELETE FROM issue_report_photos WHERE report_id IN (SELECT id FROM issue_reports WHERE order_id = ANY($1))', [oids]);
        await del('issue_reports', 'DELETE FROM issue_reports WHERE order_id = ANY($1)', [oids]);
        await del('document_orders(by order)', 'DELETE FROM document_orders WHERE order_id = ANY($1)', [oids]);
        await del('points_ledger(by order)', 'DELETE FROM points_ledger WHERE order_id = ANY($1)', [oids]);
        await del('sla_alerts', 'DELETE FROM sla_alerts WHERE order_id = ANY($1)', [oids]);
        await del('courier_offers', 'DELETE FROM courier_offers WHERE order_id = ANY($1)', [oids]);
      }
      // גילוי דינמי: כל טבלה עם tenant_id (חוץ מטבלאות שכבר טופלו) — בלי ניחוש שמות
      const { rows: tTables } = await client.query(
        `SELECT table_name FROM information_schema.columns
         WHERE column_name = 'tenant_id' AND table_schema = current_schema()
           AND table_name NOT IN ('orders','documents','document_orders','document_events')`);
      for (const { table_name } of tTables) await del(table_name, `DELETE FROM ${table_name} WHERE tenant_id = ANY($1)`, [tids]);
      await del('orders', 'DELETE FROM orders WHERE tenant_id = ANY($1)', [tids]);
      await del('tenants', 'DELETE FROM tenants WHERE id = ANY($1)', [tids]);
    }
    if (uids.length) {
      const { rows: uTables } = await client.query(
        `SELECT table_name FROM information_schema.columns
         WHERE column_name = 'user_id' AND table_schema = current_schema()
           AND table_name NOT IN ('orders','documents','tenant_members')`);
      for (const { table_name } of uTables) await del(table_name, `DELETE FROM ${table_name} WHERE user_id = ANY($1)`, [uids]);
      await del('users', 'DELETE FROM users WHERE id = ANY($1)', [uids]);
    }
    await client.query('ALTER TABLE documents ENABLE TRIGGER documents_immutable_trg');
    await client.query('COMMIT');
    console.log('ניקוי דמו הושלם ✓');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('נכשל — בוצע ROLLBACK:', e.message);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
})();
