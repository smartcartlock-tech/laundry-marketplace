const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/courier-day.js', 'utf8');
function context(stops) {
 const ctx = {window:{addEventListener(){}},onAct(){},state:{token:'demo'},esc:String,
 api:async path => path==='/auth/me'?{courier:{approved:true}}:{stops,date:'2026-10-17'}};
 vm.createContext(ctx);vm.runInContext(source,ctx);return ctx;
}
test('T27: navigation tab names the actual link-based experience and preserves route compatibility',async()=>{
 const ctx=context([]);
 const html=await ctx.vCourierMap();
 assert.match(html,/<h2>ניווט מסלול<\/h2>/);
 assert.match(html,/href="#\/courier\/map">ניווט<\/a>/);
 assert.doesNotMatch(html,/>מפה<\/a>|<h2>מפת מסלול/);
 assert.match(html,/אין מפה מובנית/);
 assert.match(html,/אין נקודות פתוחות/);
});
test('T27: navigation keeps Waze, Google Maps and full multi-stop route links',async()=>{
 const stops=[{done:false,kind:'pickup',seq:1,stop_address:'הרצל 1 תל אביב'},
 {done:false,kind:'deliver',seq:2,stop_address:'הנמל 2 חיפה'},
 {done:true,kind:'deliver',seq:3,stop_address:'לא להציג'}];
 const html=await context(stops).vCourierMap();
 assert.match(html,/2 נקודות פתוחות/);
 assert.match(html,/https:\/\/waze.com\/ul\?q=/);
 assert.match(html,/https:\/\/www.google.com\/maps\/dir\/\?api=1/);
 assert.ok(html.includes('waypoints='+encodeURIComponent(stops[0].stop_address)));
 assert.ok(!html.includes('לא להציג'));
});
