// T117: גיבוי לסביבות בדיקה שבהן checkout.js לא נטען לפני הקובץ
var fmtShekel=typeof fmtShekel==='function'?fmtShekel:function(n){return '\u20aa'+Number(n||0).toLocaleString('he-IL',{maximumFractionDigits:2})};
var fmtDMYT=typeof fmtDMYT==='function'?fmtDMYT:function(s){if(!s)return '\u2014';var d=new Date(s);return d.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Jerusalem'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jerusalem'})};
/* N1: מרכז הודעות בתוך האפליקציה — מסך #/messages + פעמון עם מונה לא-נקראו.
   עצמאי: הזרקת קישור לניווט ב-MutationObserver (כמו help.js), בלי עריכת קבצים משותפים. */

const MSG_ICON = { system: '🔔', order: '🧺', template: '📄', sim: '🧪' };

async function vMessages() {
  if (!state.token) return vLogin();
  let d;
  try { d = await api('/messages'); } catch (e) { return `<div class="body"><div class="card warn">${esc(e.message)}</div></div>`; }
  const rows = d.messages || [];
  /* T111: קיבוץ לפי הזמנה — כל העדכונים על אותה הזמנה (data.tracking_code) בכרטיס אחד;
     העדכון האחרון גלוי, הקודמים מכווצים. הודעות בלי הזמנה נשארות כרטיסים בודדים. */
  function renderMsg(m) {
    return `
    <div id="msg-${m.id}" style="display:flex;gap:8px;align-items:flex-start;${m.read_at ? 'opacity:.65' : ''};padding:6px 0;border-top:1px solid #edf1f4">
     <div style="flex:1;min-width:0;overflow-wrap:anywhere">
      <b>${esc(m.title)}</b>
      <div class="mut" style="margin:4px 0;white-space:pre-wrap">${esc(m.body)}</div>
      ${m.data && m.data.url ? `<div style="margin:4px 0"><a href="${esc(String(m.data.url))}" style="color:var(--acc,#0e7a8a);font-weight:600">↗ פתיחת המשימה</a></div>` : ''}
      <div class="mut" style="font-size:11px">${m.tenant_name ? esc(m.tenant_name) + ' · ' : ''}${fmtDMYT(m.created_at)}</div>
     </div>
     <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
      <button class="btn2" style="font-size:11px" data-act="${m.read_at ? 'msgMarkUnread' : 'msgMarkRead'}" data-a="${m.id}">${m.read_at ? 'סמן כלא נקרא' : 'נקרא'}</button>
      <button class="btn2" style="font-size:11px;color:#b71c1c" data-act="msgDelete" data-a="${m.id}">מחק</button>
     </div>
    </div>`;
  }
  const groups = [], byCode = new Map();
  for (const m of rows) {
    const code = m.kind === 'order' && m.data && m.data.tracking_code;
    if (code) {
      if (!byCode.has(code)) { const g = { code, items: [] }; byCode.set(code, g); groups.push(g); }
      byCode.get(code).items.push(m);
    } else groups.push({ solo: m });
  }
  const list = groups.length ? groups.map(g => {
    if (g.solo) {
      const m = g.solo;
      return `<div class="card" style="${m.read_at ? '' : 'border-right:3px solid var(--acc,#0e7a8a)'}">
       <div style="display:flex;gap:8px;align-items:flex-start"><div style="font-size:20px">${MSG_ICON[m.kind] || '🔔'}</div>
       <div style="flex:1;min-width:0">${renderMsg(m)}</div></div></div>`;
    }
    const items = g.items, latest = items[0], older = items.slice(1);
    const unread = items.filter(m => !m.read_at).length;
    return `<div class="card" style="${unread ? 'border-right:3px solid var(--acc,#0e7a8a)' : ''}">
     <div style="display:flex;gap:8px;align-items:flex-start">
      <div style="font-size:20px">🧺</div>
      <div style="flex:1;min-width:0">
       <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
        <b>הזמנה ${esc(g.code)}</b>
        <span class="mut" style="font-size:11px">${items.length > 1 ? items.length + ' עדכונים' : 'עדכון אחד'}${unread ? ' · ' + unread + ' חדשים' : ''}</span>
       </div>
       ${renderMsg(latest)}
       ${older.length ? `<details style="margin-top:4px"><summary style="cursor:pointer;font-size:12px;color:#0e7a8a">עדכונים קודמים (${older.length})</summary>${older.map(renderMsg).join('')}</details>` : ''}
      </div>
     </div>
    </div>`;
  }).join('')
   : '<div class="card mut" style="text-align:center;padding:30px 0">אין הודעות עדיין</div>';
  return `<div class="hdr"><h2>מרכז הודעות</h2><a href="#/notif-settings" style="color:#fff;font-size:12px">⚙️ הגדרות התראות</a></div><div class="body">
   ${d.unread ? `<div style="text-align:left;margin-bottom:8px"><button class="btn2" data-act="msgReadAll">סמן הכל כנקרא (${d.unread})</button></div>` : ''}
   ${list}
  </div>`;
}

async function msgMarkRead(id) {
  try { await api('/messages/' + id + '/read', { method: 'POST' }); } catch (e) { toast(e.message); }
  msgRefreshBadge();
  route(); // רענון הרשימה — ההודעה מעומעמת והכפתור מתחלף ל"סמן כלא נקרא"
}

async function msgMarkUnread(id) {
  try {
    await api('/messages/' + id + '/unread', { method: 'POST' });
    const el = document.getElementById('msg-' + id);
    if (el) { el.style.opacity = '1'; el.style.borderRight = '3px solid var(--acc,#0e7a8a)'; }
  } catch (e) { toast(e.message); }
  msgRefreshBadge();
  route(); // רענון הרשימה כדי שהכפתור יתחלף ל"נקרא"
}

async function msgDelete(id) {
  try { await api('/messages/' + id, { method: 'DELETE' }); } catch (e) { toast(e.message); }
  msgRefreshBadge();
  route(); // רענון הרשימה — גם מונה "סמן הכל כנקרא" מתעדכן
}

async function msgReadAll() {
  try { await api('/messages/read-all', { method: 'POST' }); route(); } catch (e) { toast(e.message); }
  msgRefreshBadge();
}

/* פעמון בניווט התחתון + מונה, מתרענן כשמחוברים */
async function msgRefreshBadge() {
  try {
    if (!state.token) return;
    const d = await api('/messages/unread-count');
    document.querySelectorAll('.msg-badge').forEach(b => {
      b.textContent = d.unread > 99 ? '99+' : String(d.unread);
      b.style.display = d.unread ? 'inline-block' : 'none';
    });
  } catch (e) {}
}

(function () {
  function inject() {
    try {
      const nav = document.querySelector('nav');
      if (!nav || nav.querySelector('a[href$="#/messages"]')) return;
      const a = document.createElement('a');
      a.href = '#/messages';
      a.style.cssText = 'color:#fff;text-decoration:none;text-align:center;font-size:11px;position:relative';
      a.innerHTML = '<div style="font-size:18px">🔔</div>הודעות' +
        '<span class="msg-badge" style="display:none;position:absolute;top:-4px;left:2px;background:#e53935;color:#fff;border-radius:9px;font-size:10px;padding:1px 5px"></span>';
      (nav.querySelector('.in') || nav).appendChild(a);
    } catch (e) {}
  }
  function watch() {
    const nav = document.querySelector('nav');
    if (!nav) return;
    inject();
    new MutationObserver(inject).observe(nav, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
  setTimeout(watch, 500); setTimeout(watch, 2000);
  setInterval(msgRefreshBadge, 60000);
  window.addEventListener('hashchange', () => setTimeout(msgRefreshBadge, 300));
  setTimeout(msgRefreshBadge, 1500);
})();
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 msgMarkRead:t=>msgMarkRead(t.dataset.a), msgMarkUnread:t=>msgMarkUnread(t.dataset.a), msgDelete:t=>msgDelete(t.dataset.a), msgReadAll:()=>msgReadAll()
});
