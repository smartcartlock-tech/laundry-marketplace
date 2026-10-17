/* N3+N4: מסך סימולציה — צ'אט מדומה עם הבוט + תיבת דואר יוצא מדומה (דוא"ל/וואטסאפ).
   סימולציה בלבד: שום הודעה לא נשלחת לאף אחד. */

let botSimLog = []; // היסטוריית צ'אט בזיכרון בלבד

function vBotSim() {
  return `<div class="hdr"><h2>סימולציית בוט</h2></div><div class="body">
  <div class="card" style="background:#fff8e1;border:1px solid #f0d060;text-align:center">
   🧪 <b>סביבת סימולציה</b> — הצ'אט וה"שליחה" כאן להדגמה בלבד. לא נשלחת שום הודעה אמיתית.
  </div>
  <div class="card">
   <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:8px">
    <button class="btn2 on" id="bs-tab-chat" data-act="botSimTab" data-a="chat">צ'אט מדומה</button>
    <button class="btn2" id="bs-tab-out" data-act="botSimTab" data-a="out">דוא"ל/וואטסאפ מדומה</button>
   </div>
   <div id="bs-chat">
    <div id="bs-log" style="min-height:120px;max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
     ${botSimLog.length ? botSimLog.map(b => botSimBubble(b.who, b.text)).join('') : '<div class="mut" style="text-align:center">כתבו "שלום" כדי להתחיל — נסו גם "מכבסות", "מחירון", "שעות", "סטטוס"</div>'}
    </div>
    <div style="display:flex;gap:6px">
     <input id="bs-in" class="inp" style="flex:1;min-width:0;margin-bottom:0" placeholder="הקלידו הודעה לבוט…" data-actk="botSimEnter">
     <button class="btn" style="flex:none;width:auto" data-act="botSimSend">שלח</button>
    </div>
   </div>
   <div id="bs-out" style="display:none">
    ${state.token ? `
    <div class="mut" style="margin-bottom:6px">ה"שליחה" נרשמת בתיבת דואר יוצא מדומה בלבד (מסמך דמו).</div>
    <select id="bo-ch" class="inp" style="margin-bottom:6px" data-actc="botOutKind">
     <option value="whatsapp">וואטסאפ (מדומה)</option>
     <option value="email">דוא"ל (מדומה)</option>
    </select>
    <input id="bo-to" class="inp" style="margin-bottom:6px" placeholder="נמען (טלפון או מייל)">
    <input id="bo-subj" class="inp" style="margin-bottom:6px;display:none" placeholder="נושא (לדוא&quot;ל)">
    <textarea id="bo-body" class="inp" rows="3" style="margin-bottom:6px" placeholder="תוכן ההודעה"></textarea>
    <button class="btn" data-act="botOutSend">שלח (סימולציה)</button>
    <div id="bo-list" style="margin-top:10px"></div>` :
    `<div class="mut" style="text-align:center">כדי להשתמש בתיבת הדואר המדומה צריך <a href="#/login">להתחבר</a> (קוד דמו מוצג במסך הכניסה).</div>`}
   </div>
  </div></div>`;
}

function botSimBubble(who, text) {
  const me = who === 'me';
  return `<div style="align-self:${me ? 'flex-start' : 'flex-end'};max-width:85%;min-width:0;overflow-wrap:anywhere;background:${me ? '#e3f2fd' : '#f1f8e9'};border-radius:12px;padding:7px 10px">
   <div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(text)}</div>
   <div class="mut" style="font-size:10px">${me ? 'אתם' : 'בוט (סימולציה)'}</div></div>`;
}

function botSimTab(which) {
  document.getElementById('bs-chat').style.display = which === 'chat' ? 'block' : 'none';
  document.getElementById('bs-out').style.display = which === 'out' ? 'block' : 'none';
  document.getElementById('bs-tab-chat').classList.toggle('on', which === 'chat');
  document.getElementById('bs-tab-out').classList.toggle('on', which === 'out');
  if (which === 'out' && state.token) botOutList();
}

async function botSimSend() {
  const inp = document.getElementById('bs-in');
  const text = (inp.value || '').trim();
  if (!text) return;
  inp.value = '';
  botSimLog.push({ who: 'me', text });
  const log = document.getElementById('bs-log');
  log.insertAdjacentHTML('beforeend', botSimBubble('me', text));
  log.scrollTop = log.scrollHeight;
  try {
    const d = await api('/bot-sim/chat', { method: 'POST', body: JSON.stringify({ message: text }) });
    botSimLog.push({ who: 'bot', text: d.reply });
    log.insertAdjacentHTML('beforeend', botSimBubble('bot', d.reply));
  } catch (e) {
    log.insertAdjacentHTML('beforeend', botSimBubble('bot', 'שגיאה: ' + e.message));
  }
  log.scrollTop = log.scrollHeight;
}

async function botOutSend() {
  const channel = document.getElementById('bo-ch').value;
  const recipient = document.getElementById('bo-to').value;
  const subject = document.getElementById('bo-subj').value;
  const body = document.getElementById('bo-body').value;
  try {
    await api('/sim-outbox/send', { method: 'POST', body: JSON.stringify({ channel, recipient, subject, body }) });
    toast('נרשם בתיבת הדואר המדומה (לא נשלח)');
    document.getElementById('bo-body').value = '';
    botOutList();
  } catch (e) { toast(e.message); }
}

async function botOutList() {
  const el = document.getElementById('bo-list');
  if (!el) return;
  try {
    const d = await api('/sim-outbox');
    el.innerHTML = (d.messages || []).map(m => `<div style="border-top:1px solid #edf1f4;padding:6px 0">
     <b>${m.channel === 'email' ? '✉️' : '💬'} ${m.channel === 'email' ? esc(m.subject || '') : ''}</b>
     <span class="mut" style="font-size:11px"> אל: ${esc(m.recipient)} · ${new Date(m.created_at).toLocaleString('he-IL')} · סימולציה</span>
     <div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(m.body)}</div></div>`).join('')
     || '<div class="mut">עוד לא נרשמו הודעות מדומות</div>';
  } catch (e) { el.innerHTML = `<div class="mut">${esc(e.message)}</div>`; }
}
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 botOutKind:t=>{document.getElementById('bo-subj').style.display=t.value==='email'?'block':'none'},
 botOutSend:()=>botOutSend(), botSimSend:()=>botSimSend(), botSimTab:t=>botSimTab(t.dataset.a),
 botSimEnter:(t,e)=>{if(e.key==='Enter')botSimSend()}
});
