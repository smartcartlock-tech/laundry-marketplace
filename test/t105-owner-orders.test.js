// T105: הזמנות בעלים — ברירת מחדל 'דורש פעולה', צ'יפי סטטוס, חיפוש, ספירת ממתינות, סימון איחור
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname,'..','public','js','community.js'),'utf8');

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

const ORDERS=[
 {id:'11111111-aaaa',customer_name:'דינה',customer_phone:'0501111111',status:'new',created_at:new Date(Date.now()-45*60000).toISOString(),total:80,address:'רחוב 1',items:[],courier_id:null,has_open_offer:false},
 {id:'22222222-bbbb',customer_name:'אבי',customer_phone:'0502222222',status:'confirmed',created_at:new Date().toISOString(),total:50,address:'רחוב 2',items:[],courier_id:'c9',has_open_offer:false},
 {id:'33333333-cccc',customer_name:'מיכל',customer_phone:'0503333333',status:'delivered',created_at:new Date().toISOString(),total:60,address:'רחוב 3',items:[],courier_id:'c9',has_open_offer:false},
 {id:'44444444-dddd',customer_name:'רמי',customer_phone:'0504444444',status:'cancelled',created_at:new Date().toISOString(),total:40,address:'רחוב 4',items:[],courier_id:null,has_open_offer:false},
];
function mkApi(orders){return async p=>{
 if(p==='/auth/me')return {user:{id:'u1'},memberships:[{slug:'m1',name:'מכבסה',role:'owner'}]};
 if(p==='/t/m1/orders')return {orders};
 return {};
}}

test("T105: ברירת מחדל 'דורש פעולה' — חדשות וממתינות לשיבוץ בלבד; מבוטלות לא מעורבבות", async ()=>{
 const sb=sandbox(mkApi(ORDERS));
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html=await sb.vManage('orders');
 assert.ok(html.includes('דינה'),'הזמנה חדשה מוצגת');
 assert.ok(!html.includes('מיכל'),'הושלמה לא מוצגת בברירת מחדל');
 assert.ok(!html.includes('רמי'),'מבוטלה לא מעורבבת');
 assert.ok(html.includes('1 מחכות לאישור'),'ספירת ממתינות');
 assert.ok(html.includes('⏰ ממתינה 45 דק׳'),'סימון איחור מעל 30 דקות');
 assert.ok(html.includes('#/manage/orders?f=all'),'צ׳יפ הכל');
 assert.ok(html.includes('data-acti="moSearch"'),'תיבת חיפוש');
 assert.ok(html.includes('data-q='),'כרטיסים עם נתוני חיפוש');
});

test('T105: מסנן פעילות/הושלמו/מבוטלות/הכל לפי ?f=', async ()=>{
 const sb=sandbox(mkApi(ORDERS),'#/manage/orders?f=done');
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html=await sb.vManage('orders');
 assert.ok(html.includes('מיכל'),'הושלמו מוצגות');
 assert.ok(!html.includes('דינה'),'חדשה לא מוצגת');
 const sb2=sandbox(mkApi(ORDERS),'#/manage/orders?f=cancelled');
 sb2.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html2=await sb2.vManage('orders');
 assert.ok(html2.includes('רמי'),'מבוטלות מוצגות');
 assert.ok(!html2.includes('אבי'));
 const sb3=sandbox(mkApi(ORDERS),'#/manage/orders?f=all');
 sb3.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html3=await sb3.vManage('orders');
 assert.ok(html3.includes('דינה')&&html3.includes('מיכל')&&html3.includes('רמי')&&html3.includes('אבי'),'הכל מוצג');
});

test('T105: מסנן פעילות מציג הזמנות בטיפול', async ()=>{
 const sb=sandbox(mkApi(ORDERS),'#/manage/orders?f=active');
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html=await sb.vManage('orders');
 assert.ok(html.includes('דינה')&&html.includes('אבי'),'פעילות מוצגות');
 assert.ok(!html.includes('מיכל')&&!html.includes('רמי'),'סופיות לא מוצגות');
});

test('T105: חיפוש לקוח/טלפון — moSearch מסתיר כרטיסים לא תואמים', ()=>{
 assert.match(src,/moSearch:t=>\{/);
 assert.match(src,/data-acti="moSearch"/);
});
