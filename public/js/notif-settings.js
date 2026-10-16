/* N7: דף הגדרות התראות — מה מקבלים ומתי. כולל "שקט בשבת וחגים" (אופט-אין). */

async function vNotifSettings() {
  if (!state.token) return vLogin();
  let d;
  try { d = await api('/me/notification-settings'); } catch (e) { return `<div class="body"><div class="card warn">${esc(e.message)}</div></div>`; }
  const p = d.prefs || {};
  const row = (key, title, desc) => `
   <div class="card" style="display:flex;gap:10px;align-items:center">
    <div style="flex:1"><b>${title}</b><div class="mut" style="font-size:12px;margin-top:2px">${desc}</div></div>
    <button class="btn2" data-act="notifToggle" data-a="${key}" style="min-width:64px;${p[key] ? 'background:#0e7a8a;color:#fff' : ''}">${p[key] ? 'פעיל' : 'כבוי'}</button>
   </div>`;
  return `<div class="hdr"><h2>הגדרות התראות</h2></div><div class="body">
   ${d.quiet_now ? `<div class="card warn">🤫 כרגע זמן שקט (${esc(d.quiet_reason || '')}) — הודעות לא יישלחו עד צאת הזמן.</div>` : ''}
   ${row('status_updates', 'עדכוני סטטוס הזמנה', 'הודעה כשההזמנה מאושרת, נאספת, מוכנה או בדרך אליך')}
   ${row('order_messages', 'הודעות במרכז ההודעות', 'עותק פנימי של כל עדכון — מופיע במסך "הודעות" עם הפעמון')}
   ${row('marketing', 'הטבות ועדכונים שיווקיים', 'מבצעים והטבות מועדון (בדמו אין שליחה אמיתית)')}
   ${row('quiet_shabbat', 'שקט בשבת וחגים', 'בשבת (שישי 16:00 — מוצאי שבת 20:00) ובחגים לא יישלחו התראות כלל, גם לא לפעמון')}
   <div class="mut" style="font-size:12px;text-align:center">ההגדרות נשמרות אוטומטית בכל לחיצה · סביבת דמו</div>
  </div>`;
}

async function notifToggle(key) {
  try {
    const cur = await api('/me/notification-settings');
    const next = {}; next[key] = !cur.prefs[key];
    await api('/me/notification-settings', { method: 'PUT', body: JSON.stringify(next) });
    route();
  } catch (e) { toast(e.message); }
}

/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({ notifToggle: t => notifToggle(t.dataset.a) });
