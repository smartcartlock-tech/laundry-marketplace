/* N1: מרכז הודעות בתוך האפליקציה — מסך #/messages + פעמון עם מונה לא-נקראו.
   עצמאי: הזרקת קישור לניווט ב-MutationObserver (כמו help.js), בלי עריכת קבצים משותפים. */

const MSG_ICON = { system: '🔔', order: '🧺', template: '📄', sim: '🧪' };

async function vMessages() {
  if (!state.token) return vLogin();
  let d;
  try { d = await api('/messages'); } catch (e) { return `<div class="body"><div class="card warn">${esc(e.message)}</div></div>`; }
  const rows = d.messages || [];
  const list = rows.length ? rows.map(m => `
   <div class="card" id="msg-${m.id}" style="${m.read_at ? 'opacity:.65' : 'border-right:3px solid var(--acc,#0e7a8a)'}">
    <div style="display:flex;gap:8px;align-items:flex-start">
     <div style="font-size:20px">${MSG_ICON[m.kind] || '🔔'}</div>
     <div style="flex:1">
      <b>${esc(m.title)}</b>
      <div class="mut" style="margin:4px 0;white-space:pre-wrap">${esc(m.body)}</div>
      <div class="mut" style="font-size:11px">${m.tenant_name ? esc(m.tenant_name) + ' · ' : ''}${new Date(m.created_at).toLocaleString('he-IL')}</div>
     </div>
     ${m.read_at ? '' : `<button class="btn2" style="font-size:11px" onclick="msgMarkRead('${m.id}')">נקרא</button>`}
    </div>
   </div>`).join('')
   : '<div class="card mut" style="text-align:center;padding:30px 0">אין הודעות עדיין</div>';
  return `<div class="hdr"><h2>מרכז הודעות</h2></div><div class="body">
   ${d.unread ? `<div style="text-align:left;margin-bottom:8px"><button class="btn2" onclick="msgReadAll()">סמן הכל כנקרא (${d.unread})</button></div>` : ''}
   ${list}
  </div>`;
}

async function msgMarkRead(id) {
  try {
    await api('/messages/' + id + '/read', { method: 'POST' });
    const el = document.getElementById('msg-' + id);
    if (el) { el.style.opacity = '.65'; el.style.borderRight = 'none'; const b = el.querySelector('button'); if (b) b.remove(); }
  } catch (e) { toast(e.message); }
  msgRefreshBadge();
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
