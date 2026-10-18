// N6: הודעות מבוססות-תבניות על אירועי הזמנה — שליח על משימה חדשה, מכבסה על הזמנה חדשה.
// עובר דרך notifyUser בלבד: במצב דמו נשלח אמיתית רק ל-DEMO_NOTIFY_ALLOWLIST, אחרת סימולציה בלוג.
// notifyUser גם מעתיק כל הודעה למרכז ההודעות (user_messages), אז אין כפילות כאן.
const { q } = require('./db');
const { notifyUser } = require('./notify');
const { renderTemplateByKey } = require('./usermessages');

// שליח קיבל משימה חדשה (שיבוץ ידני מהמכבסה או הצעת שיבוץ מהפלטפורמה)
async function notifyCourierNewTask(courierUser, tenant, order, mode = 'assign') {
  if (!courierUser || !courierUser.id) return;
  const t = await renderTemplateByKey('courier_new_task', {
    'סוג': mode === 'offer' ? 'הצעת שיבוץ חדשה מהפלטפורמה — אשר/י באפליקציית השליח' : 'שובצת לאיסוף/החזרה',
    'קוד': order.tracking_code || String(order.id).slice(0, 8),
    'מכבסה': tenant.name, 'כתובת': order.address,
  });
  const body = t ? t.body : `משימה חדשה: הזמנה ${order.tracking_code || order.id} ב${tenant.name}. כתובת: ${order.address}`;
  await notifyUser(courierUser.id, tenant.id, body, courierUser.phone, t ? t.title : undefined, { url: './#/courier' }); // deep-link: לחיצה על ה-push מובילה למסך השליח
}

// בעלי/צוות המכבסה מקבלים הודעה על הזמנה חדשה שהתקבלה
async function notifyLaundryNewOrder(tenant, order, customer) {
  const { rows: members } = await q(
    'SELECT u.id, u.phone FROM tenant_members tm JOIN users u ON u.id = tm.user_id WHERE tm.tenant_id=$1', [tenant.id]);
  if (!members.length) return;
  const t = await renderTemplateByKey('laundry_new_order', {
    'קוד': order.tracking_code || String(order.id).slice(0, 8),
    'לקוח': (customer && customer.name) || 'לקוח/ה',
    'סכום': order.total,
  });
  const body = t ? t.body : `הזמנה חדשה ${order.tracking_code || order.id} — סה"כ ₪${order.total}.`;
  for (const m of members) await notifyUser(m.id, tenant.id, body, m.phone, t ? t.title : undefined, { url: './#/manage' }); // deep-link ללוח הניהול (T110/G)
}

module.exports = { notifyCourierNewTask, notifyLaundryNewOrder };
