/* ביקורת סשנים: רשימת המכשירים המחוברים של המשתמש + ניתוק מרחוק */
async function vSessions(){
 const d=await api('/me/sessions');
 return `<div class="hdr"><h2>מכשירים מחוברים</h2></div><div class="body">
  <div class="card">${d.sessions.map(s=>`
   <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eee">
    <div><div style="font-size:13px">${esc(s.user_agent||'מכשיר לא ידוע').slice(0,60)}</div>
     <div class="mut" style="font-size:12px">חיבור אחרון: ${fmtDT(s.last_seen_at)}${s.ip?' · '+esc(s.ip):''} · פג: ${fmtDT(s.expires_at)}</div></div>
    ${s.current?'<span class="st-pill st-delivered">מכשיר נוכחי</span>':`<button class="btn2" data-act="revokeSession" data-a="${s.id}">ניתוק</button>`}
   </div>`).join('')||'<div class="mut">אין סשנים פעילים</div>'}</div>
  <button class="btn2" style="margin-top:10px;color:#c22;border-color:#f3c2c2" data-act="revokeAllSessions">ניתוק מכל המכשירים האחרים</button></div>`;
}
onAct({
 revokeSession:async t=>{await api('/me/sessions/'+t.dataset.a,{method:'DELETE'});toast('המכשיר נותק');route()},
 revokeAllSessions:async t=>{const r=await api('/me/sessions/revoke-all',{method:'POST'});toast('נותקו '+(r.revoked||0)+' מכשירים');route()}
});
