// T90: ניתוב אחרי כניסה לפי תפקיד + כפתור 'כניסה' קבוע לאורח בניווט
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mkEl(){ return { innerHTML:'', value:'', style:{}, classList:{add(){},remove(){}}, querySelector:()=>null, insertAdjacentHTML(){}, setAttribute(){}, focus(){}, remove(){} }; }
function sandbox(extra={}){
 const els={};
 const sb={
  console, URLSearchParams, setInterval, clearInterval, setTimeout, Promise, JSON, Math, Date, Number, String, Array, Object,
  location:{ hash:'#/', pathname:'/' },
  document:{ querySelectorAll:()=>[], querySelector:s=>els[s]||(els[s]=mkEl()) },
  window:{ addEventListener(){}, scrollTo(){} },
  api:async()=>({}), toast(){}, onAct(){},
  vLogin:()=>'<input id="login-target">', vHome:async()=>'<div class="hdr"></div>', orderPoll:null,
  ...extra,
 };
 sb.window.location=sb.location;
 vm.createContext(sb);
 for(const f of ['core.js','tabs.js','router.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','public','js',f),'utf8'),sb);
 sb.S=code=>vm.runInContext(code,sb); // מוטציה של ה-bindings הלקסיקליים (let state וכו')
 return sb;
}

test('T90: מחובר שנכנס ל-#/login מנותב לבית התפקיד — בעלים לניהול, שליח למסלול, לקוח לבית', async ()=>{
 for(const [setup,want] of [
  [`state.token='t';state.memberships=[{slug:'a'}];state.courier=null`,'#/manage'],
  [`state.token='t';state.memberships=[];state.courier={id:'c1'}`,'#/courier/day'],
  [`state.token='t';state.memberships=[];state.courier=null`,'#/'],
 ]){
  const sb=sandbox();
  sb.S(setup);
  sb.location.hash='#/login';
  await sb.route();
  assert.equal(sb.location.hash,want,setup);
 }
});

test('T90: נחיתה אחרי כניסה — בלי returnTo הולכים לבית התפקיד', ()=>{
 const sb=sandbox();
 sb.S(`__preLogin=true;state.token='t';state.memberships=[{slug:'a'}];state.courier=null`);
 sb.go('#/');
 assert.equal(sb.location.hash,'#/manage');
 const sb2=sandbox();
 sb2.S(`__preLogin=true;state.token='t';state.memberships=[];state.courier={id:'c'}`);
 sb2.go('#/');
 assert.equal(sb2.location.hash,'#/courier/day');
 const sb3=sandbox();
 sb3.S(`__preLogin=true;state.token='t';state.memberships=[];state.courier=null`);
 sb3.go('#/');
 assert.equal(sb3.location.hash,'#/');
});

test('T90: אין הפניה לטופס שליח/לוח זר אחרי כניסה; returnTo תקין נשמר', ()=>{
 const sb=sandbox(); // בעלים עם returnTo למסך שליח → ניהול
 sb.S(`__preLogin=true;state.token='t';state.memberships=[{slug:'a'}];state.courier=null`);
 sb.go('#/courier');
 assert.equal(sb.location.hash,'#/manage');
 const sb2=sandbox(); // לקוח עם returnTo לניהול → בית
 sb2.S(`__preLogin=true;state.token='t';state.memberships=[];state.courier=null`);
 sb2.go('#/manage');
 assert.equal(sb2.location.hash,'#/');
 const sb3=sandbox(); // returnTo לצ'ק-אאוט נשמר
 sb3.S(`__preLogin=true;state.token='t';state.memberships=[];state.courier=null`);
 sb3.go('#/checkout/achuza');
 assert.equal(sb3.location.hash,'#/checkout/achuza');
 const sb4=sandbox(); // returnTo להרשמת שליח של לקוח נשמר (כוונה מודעת)
 sb4.S(`__preLogin=true;state.token='t';state.memberships=[];state.courier=null`);
 sb4.go('#/courier');
 assert.equal(sb4.location.hash,'#/courier');
 const sb5=sandbox(); // אורח מנווט — לא מנורמל
 sb5.S(`__preLogin=true;state.token=null;state.memberships=[];state.courier=null`);
 sb5.go('#/club');
 assert.equal(sb5.location.hash,'#/club');
});

test('T90: אורח רואה כפתור כניסה בסרגל התחתון; מחובר — לא', ()=>{
 const sb=sandbox();
 sb.S(`state.token=null;state.memberships=[];state.courier=null`);
 sb.renderTabs('#/');
 const html=sb.document.querySelector('#tabs').innerHTML;
 assert.ok(html.includes('#/login'),'יש פריט כניסה');
 const sb2=sandbox();
 sb2.S(`state.token='t';state.memberships=[];state.courier=null`);
 sb2.renderTabs('#/');
 assert.ok(!sb2.document.querySelector('#tabs').innerHTML.includes('#/login'),'מחובר לא רואה כניסה');
});

test('T90+T116: סרגל תחתון עד 5 פריטים לכל תפקיד, מותאם תפקיד', ()=>{
 for(const setup of [
  `state.token=null;state.memberships=[];state.courier=null;state.me=null`,
  `state.token='t';state.memberships=[];state.courier=null;state.me=null`,
  `state.token='t';state.memberships=[];state.courier={id:'c'};state.me=null`,
  `state.token='t';state.memberships=[{slug:'a'}];state.courier=null;state.me=null`,
  `state.token='t';state.memberships=[{slug:'a'}];state.courier={id:'c'};state.me=null`,
  `state.token='t';state.memberships=[{slug:'a'}];state.courier={id:'c'};state.me={role:'admin'}`,
 ]){
  const sb=sandbox();
  sb.S(setup);
  sb.renderTabs('#/');
  const html=sb.document.querySelector('#tabs').innerHTML;
  const n=(html.match(/<a href=/g)||[]).length;
  assert.ok(n<=5,`${setup} → ${n} פריטים`);
 }
 const sbC=sandbox();
 sbC.S(`state.token='t';state.memberships=[];state.courier={id:'c'};state.me=null`);
 sbC.renderTabs('#/');
 assert.ok(sbC.document.querySelector('#tabs').innerHTML.includes('#/courier/day'),'שליח: מסלול');
 const sbO=sandbox();
 sbO.S(`state.token='t';state.memberships=[{slug:'a'}];state.courier=null;state.me=null`);
 sbO.renderTabs('#/');
 assert.ok(sbO.document.querySelector('#tabs').innerHTML.includes('#/manage'),'בעלים: ניהול');
});
