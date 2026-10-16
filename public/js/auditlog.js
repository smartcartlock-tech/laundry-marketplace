/* יומן ביקורת אדמין: צפייה בפעולות מנהל הפלטפורמה (מקור: GET /api/admin/audit-log) */
async function vAdminAudit(){
 const d=await api('/admin/audit-log?limit=200');
 return `<div class="card"><b>יומן ביקורת — פעולות מנהל אחרונות</b>
  <table class="tbl"><tr><th>מתי</th><th>מבצע</th><th>פעולה</th><th>יעד</th></tr>
  ${d.entries.map(e=>`<tr><td>${fmtDT(e.created_at)}</td><td>${esc(e.actor_label||'—')}</td><td dir="ltr" style="text-align:right">${esc(e.action)}</td><td><span dir="ltr">${esc(e.target_id||'—')}</span></td></tr>`).join('')||'<tr><td colspan="4" class="mut">אין רשומות עדיין</td></tr>'}</table></div>`;
}
