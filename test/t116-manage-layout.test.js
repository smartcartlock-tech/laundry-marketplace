// T116: קיבוץ 16+ לשוניות ניהול ל-4 קבוצות (תפעול/מכירות/כספים/הגדרות) + כרטיסי סיכום מכווצים.
// אילוץ מרכזי: עטיפות של קבצים אחרים מזריקות צ'יפים ל-subtabs לפני ה-</div> הראשון — ה-subtabs חייב להישאר שטוח.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function sandbox(api,hash){
 const els={};
 const mkEl=()=>({ innerHTML:'', value:'', style:{}, classList:{add(){},remove(){}}, querySelector:()=>null, insertAdjacentHTML(){}, setAttribute(){}, focus(){}, remove(){} });
 const sb={
  console, URLSearchParams, setInterval, clearInterval, setTimeout, clearTimeout, Promise, JSON, Math, Date, Number, String, Array, Object,
  location:{ hash:hash||'#/manage/orders', pathname:'/' },
  document:{ querySelectorAll:()=>[], querySelector:s=>els[s]||(els[s]=mkEl()) },
  window:{ addEventListener(){}, scrollTo(){} },
  api, toast(){}, onAct(){}, xmodal:async()=>null, needLogin:()=>'',
  orderPoll:null, route(){}, go(){},
  localStorage:{ getItem:()=>null, setItem(){}, removeItem(){} },
 };
 sb.window.location=sb.location;
 sb.__stubApi=api;
 vm.createContext(sb);
 for(const f of ['core.js','tabs.js','manage.js','community.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','public','js',f),'utf8'),sb);
 sb.S=code=>vm.runInContext(code,sb);
 sb.S('api=__stubApi');
 return sb;
}

function mkApi(){return async p=>{
 if(p==='/auth/me')return {user:{id:'u1'},memberships:[{slug:'m1',name:'מכבסה',role:'owner'}]};
 if(p==='/t/m1/orders')return {orders:[]};
 if(p==='/t/m1/checklist')return {percent:100,complete:true,items:[{done:true,label:'מחירון',action:''}]};
 if(p==='/t/m1/agreement')return {accepted_at:'2026-10-01T10:00:00Z',accepted_version:'1.2',version:'1.2'};
 if(p==='/t/m1/ops/daily-summary')return {date:'2026-10-18',created_today:3,picked_today:2,delivered_today:1,late:[],couriers:[]};
 if(p==='/t/m1/ops/state')return {paused_until:null,closures:[]};
 return {};
}}

function subtabsBlock(html){
 const i=html.indexOf('<div class="subtabs">');
 assert.ok(i>=0,'קיים בלוק subtabs');
 const j=html.indexOf('</div>',i);
 assert.ok(j>i,'נמצאה סגירת subtabs');
 return html.slice(i,j);
}

test('T116: 4 קבוצות לשוניות בסדר הנכון, כספים אחרונה (לצ׳יפים מוזרקים של כספים)', async ()=>{
 const sb=sandbox(mkApi());
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html=await sb.vManage('orders');
 const st=subtabsBlock(html);
 const iOps=st.indexOf('תפעול'), iSales=st.indexOf('מכירות'), iSet=st.indexOf('הגדרות'), iMoney=st.indexOf('כספים');
 for(const [n,i] of [['תפעול',iOps],['מכירות',iSales],['הגדרות',iSet],['כספים',iMoney]]) assert.ok(i>=0,'תווית קבוצה: '+n);
 assert.ok(iOps<iSales && iSales<iSet && iSet<iMoney,'סדר קבוצות: תפעול→מכירות→הגדרות→כספים');
});

test('T116: שיוך לשוניות לקבוצות — תמיכה/ביקורות מובנים, הזמנות בתפעול, מסמכים בכספים', async ()=>{
 const sb=sandbox(mkApi());
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const st=subtabsBlock(await sb.vManage('orders'));
 const at=href=>st.indexOf('#/manage/'+href);
 const lbl=n=>st.indexOf(n);
 assert.ok(at('orders')>lbl('תפעול') && at('orders')<lbl('מכירות'),'הזמנות תחת תפעול');
 assert.ok(at('support')>lbl('תפעול') && at('support')<lbl('מכירות'),'תמיכה תחת תפעול');
 assert.ok(at('reviews')>lbl('מכירות') && at('reviews')<lbl('הגדרות'),'ביקורות תחת מכירות');
 assert.ok(at('coupons')>lbl('מכירות') && at('coupons')<lbl('הגדרות'),'קופונים תחת מכירות');
 assert.ok(at('settings')>lbl('הגדרות') && at('settings')<lbl('כספים'),'הגדרות תחת הגדרות');
 assert.ok(at('documents')>lbl('כספים'),'מסמכים תחת כספים');
 assert.ok(at('stats')>lbl('כספים'),'דוחות תחת כספים');
 assert.ok(at('today')>-1 && at('couriers')>-1 && at('items')>-1 && at('windows')>-1 && at('subs')>-1 && at('biz')>-1 && at('customers')>-1 && at('issues')>-1,'כל 13 הלשוניות הבסיסיות קיימות');
});

test('T116: חוזה ההזרקה נשמר — אין div מקונן בתוך subtabs, והצ׳יפ הפעיל מסומן', async ()=>{
 const sb=sandbox(mkApi());
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html=await sb.vManage('orders');
 const st=subtabsBlock(html);
 assert.ok(!st.slice('<div class="subtabs">'.length).includes('<div'),'אין div מקונן ב-subtabs (חוזה העטיפות)');
 assert.ok(st.includes('class="chip on" href="#/manage/orders"'),'צ׳יפ הזמנות מסומן on');
 // סימולציית הזרקה כמו bookkeeping.js/settlement.js: צ׳יף נוחת לפני ה-</div> הראשון = סוף קבוצת כספים
 const injected=html.replace(/(<div class="subtabs">[\s\S]*?)(<\/div>)/,(mm,a,b)=>a+'<a class="chip" href="#/manage/bookkeeping">הנה״ח</a>'+b);
 const st2=subtabsBlock(injected);
 assert.ok(st2.indexOf('#/manage/bookkeeping')>st2.indexOf('כספים'),'צ׳יף מוזרק נוחת בקבוצת כספים');
});

function loadOpsWrappers(sb){
 sb.S('window.vManage=vManage');
 for(const f of ['tenant-ops.js','tenant-checklist.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','public','js',f),'utf8'),sb);
 return sb;
}

test('T116: כרטיסי סיכום מכווצים בלשוניות רגילות, פתוחים בלשונית היום', async ()=>{
 const sb=loadOpsWrappers(sandbox(mkApi()));
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const ordersHtml=await sb.window.vManage('orders');
 assert.ok(ordersHtml.includes('<details class="card"'),'כרטיסים עטופים ב-details');
 assert.ok(!ordersHtml.includes('<details class="card" open'),'בלשונית הזמנות הכרטיסים מכווצים');
 for(const t of ['סיכום יומי','מוכנות המכבסה','זמינות לקבלת הזמנות']) assert.ok(ordersHtml.includes(t),'כותרת נשארת גלויה: '+t);
 assert.ok(ordersHtml.includes('3 נוצרו · 2 נאספו · 1 נמסרו'),'שורת סיכום מספרים בכיווץ');
 const todayHtml=await sb.window.vManage('today');
 const openCount=(todayHtml.match(/<details class="card" open>/g)||[]).length;
 assert.ok(openCount>=3,'בלשונית היום 3 הכרטיסים פתוחים (נמצאו '+openCount+')');
 assert.ok(todayHtml.includes('<div class="subtabs">'),'עוגן subtabs נשמר');
});
