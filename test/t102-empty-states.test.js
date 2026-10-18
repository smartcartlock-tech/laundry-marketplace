// T102: טאב שליחים — רשימה או מצב ריק + 'הוסף שליח'; מסגרת מצבי ריק בכל לשוניות הניהול
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
  orderPoll:null, route(){}, go(){}, pushSubscribe(){},
 };
 sb.window.location=sb.location;
 sb.__stubApi=api;
 sb.localStorage={ getItem:()=>null, setItem(){}, removeItem(){} };
 vm.createContext(sb);
 for(const f of ['core.js','tabs.js','manage.js','community.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','public','js',f),'utf8'),sb);
 sb.S=code=>vm.runInContext(code,sb);
 sb.S('api=__stubApi'); // api אמיתי מ-core.js מוחלף בסטאב
 return sb;
}

test('T102: טאב שליחים ריק — מצב ריק מעוצב + כפתור הוסף שליח, וללא קריסה כשestimate חסר', async ()=>{
 const sb=sandbox(async p=>{
  if(p==='/auth/me')return {user:{id:'u1'},memberships:[{slug:'m1',name:'מכבסה',role:'owner'}]};
  if(p==='/t/m1/couriers/overview')return {estimate:null,couriers:[],today:[],clusters:[],payments:[]};
  return {};
 });
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html=await sb.vManage('couriers');
 assert.ok(html.includes('אין שליחים זמינים'),'כותרת מצב ריק');
 assert.ok(html.includes('data-act="addPrivateCourier"'),'כפתור הוסף שליח');
 assert.ok(!html.includes('undefined'),'אין undefined גולמי');
});

test('T102: טאב שליחים עם שליח — מוצגת רשימה, לא מצב ריק', async ()=>{
 const sb=sandbox(async p=>{
  if(p==='/auth/me')return {user:{id:'u1'},memberships:[{slug:'m1',name:'מכבסה',role:'owner'}]};
  if(p==='/t/m1/couriers/overview')return {estimate:{rate_per_stop:8,stops_per_order:2,per_order:16,platform_commission_pct:15},couriers:[{id:'c1',name:'רמי',model:'platform',phone:'050',vehicle:'אופנוע',areas:[],delivered_30d:3,pickups_30d:0,ontime_30d:0,rating:null,rating_count:0,active_orders:0}],today:[],clusters:[],payments:[]};
  return {};
 });
 sb.S(`state.token='t';state.memberships=[{slug:'m1',name:'מכבסה',role:'owner'}]`);
 const html=await sb.vManage('couriers');
 assert.ok(html.includes('רמי'),'השליח מוצג');
 assert.ok(!html.includes('אין שליחים זמינים'));
});

test('T102: מסגרת מצבי ריק בכל הלשוניות — מחירון, חלונות, לקוחות', ()=>{
 assert.match(src,/mgEmpty\('🧺','המחירון ריק'/);
 assert.match(src,/mgEmpty\('🕐','אין חלונות איסוף\/החזרה'/);
 assert.match(src,/mgEmpty\('👥','עדיין אין לקוחות'/);
 assert.match(src,/mgEmpty\('🛵','אין שליחים זמינים'/);
});

test('T102: פעולת addPrivateCourier רשומה ומוגדרת', ()=>{
 assert.match(src,/addPrivateCourier:t=>addPrivateCourier/);
 assert.match(src,/async function addPrivateCourier\(slug\)/);
});
