// T120: מסך 'היום' לבעלים — שלושה מקטעים מבצעיים + בחירה מרובה; ברירת מחדל של לוח הניהול
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname,'..','public','js','community.js'),'utf8');

function sandbox(api){
 const els={};
 const mkEl=()=>({ innerHTML:'', value:'', style:{}, classList:{add(){},remove(){}}, querySelector:()=>null, insertAdjacentHTML(){}, setAttribute(){}, focus(){}, remove(){} });
 const sb={
  console, URLSearchParams, setInterval, clearInterval, setTimeout, clearTimeout, Promise, JSON, Math, Date, Number, String, Array, Object,
  location:{ hash:'#/manage', pathname:'/' },
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

const ilNow=new Date();
const iso=(h)=>new Date(ilNow.getTime()+h*3600e3).toISOString();
const ORDERS=[
 {id:'11111111-aaaa',customer_name:'דינה',status:'new',created_at:iso(-1),total:80,address:'רחוב 1',items:[],courier_id:null},
 {id:'22222222-bbbb',customer_name:'אבי',status:'confirmed',created_at:iso(-20),total:50,address:'רחוב 2',items:[],courier_id:'c9',pickup_at:iso(2)},
 {id:'33333333-cccc',customer_name:'מיכל',status:'ready',created_at:iso(-30),total:60,address:'רחוב 3',items:[],courier_id:'c9',delivery_at:iso(5)},
 {id:'44444444-dddd',customer_name:'רמי',status:'ready',created_at:iso(-50),total:40,address:'רחוב 4',items:[],courier_id:'c9',delivery_at:iso(50)},
];
function mkApi(){return async p=>{
 if(p==='/auth/me')return {user:{id:'u1'},memberships:[{slug:'m1',name:'מכבסה',role:'owner'}]};
 if(p==='/t/m1/orders')return {orders:ORDERS};
 return {};
}}

test("T120: לוח הניהול נפתח במסך 'היום' עם שלושת המקטעים המבצעיים", async ()=>{
 const sb=sandbox(mkApi());
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html=await sb.vManage(); // בלי sub — ברירת מחדל
 assert.ok(html.includes('מחכות לאישור (1)'),'מקטע ממתינות');
 assert.ok(html.includes('לאסוף היום (1)'),'מקטע איסופי היום');
 assert.ok(html.includes('להחזיר היום (1)'),'מקטע החזרות היום');
 assert.ok(html.includes('דינה')&&html.includes('אבי')&&html.includes('מיכל'),'ההזמנות הרלוונטיות');
 assert.ok(!html.includes('רמי'),'החזרה שלא היום לא מוצגת');
 assert.ok(html.includes('class="mo-bulk"'),'צ׳קבוקסים לבחירה מרובה');
 assert.ok(html.includes('data-act="moBulkNext"'),'כפתור קידום מרובה');
 assert.ok(html.includes('data-actc="moBulkAll"'),'בחר הכל');
 assert.ok(html.includes('#/manage/today'),'צ׳יפ היום בתפריט');
});

test('T120: פעולות מרובות רשומות; bulk-status בשרת', ()=>{
 assert.match(src,/moBulkAll:t=>\{/);
 assert.match(src,/moBulkNext:t=>moBulkNext/);
 const srv=fs.readFileSync(path.join(__dirname,'..','src','routes','tenant.js'),'utf8');
 assert.match(srv,/r\.post\('\/orders\/bulk-status'/);
 assert.match(srv,/async function transitionOrder\(/);
});
