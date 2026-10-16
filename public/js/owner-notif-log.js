/* N8: מסך לוג התראות מדומות לבעל מכבסה — מה היה נשלח ולמי בפרודקשן אמיתי */

async function vOwnerNotifLog(slug) {
  if (!state.token) return vLogin();
  let d;
  try { d = await api(`/t/${encodeURIComponent(slug)}/notif-log`); } catch (e) { return `<div class="body"><div class="card warn">${esc(e.message)}</div></div>`; }
  const rows = (d.log || []).map(x => `
   <div class="card">
    <div style="display:flex;justify-content:space-between;font-size:12px" class="mut">
     <span>${new Date(x.at).toLocaleString('he-IL')}</span>
     <span>${esc(x.channel_he)}</span>
    </div>
    <div style="margin:6px 0;white-space:pre-wrap">${esc(x.body)}</div>
    <div class="mut" style="font-size:12px">אל: ${esc(x.to)} ${x.phone !== '—' ? '· ' + esc(x.phone) : ''}</div>
   </div>`).join('');
  return `<div class="hdr"><h2>לוג התראות (סימולציה)</h2></div><div class="body">
   <div class="card" style="background:#fff8e1">🧪 ${esc(d.note || '')}</div>
   ${rows || '<div class="card mut" style="text-align:center;padding:30px 0">עוד לא נרשמו התראות למכבסה זו</div>'}
  </div>`;
}

/* B7: אין פעולות — מסך צפייה בלבד */
