const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function context(status, payment_status='pending'){
 const order={id:'order1234',status,payment_status,customer_id:'u',tenant_name:'מכבסת בדיקה',payment_method:'demo_online',total:70};
 const sb={state:{token:'t',me:{id:'u'}},api:async p=>p==='/orders/order1234'?{order,items:[{name:'שק',qty:'2.0',price:'35.00'}],events:[],reviewed:true}:p==='/documents/mine'?{documents:[]}:{reports:[]},FLOW:['new','confirmed','delivered'],HE:{},fmtDT:()=>'',fmtQ:n=>String(Number(n)),esc:String,onAct(){},setInterval:()=>1,clearInterval(){},window:{}};
 vm.createContext(sb); vm.runInContext(fs.readFileSync('public/js/orders.js','utf8'),sb);return sb;
}
test('order quantities have no redundant decimal',async()=>{
 const html=await context('delivered').vOrder('order1234');
 assert.ok(html.includes('2 × ₪35.00'));assert.ok(!html.includes('2.0 ×'));
});
test('completed orders do not claim automatic refresh',async()=>{
 const html=await context('delivered').vOrder('order1234');
 assert.ok(html.includes('ההזמנה הושלמה'));assert.ok(!html.includes('כל 20 שניות'));
});
test('active orders explain periodic and optional manual checks',async()=>{
 const html=await context('new').vOrder('order1234');
 assert.ok(html.includes('כל 20 שניות'));assert.ok(html.includes('בדיקה נוספת עכשיו'));
});
test('demo paid has persistent confirmation and explicit no-charge copy',async()=>{
 const html=await context('delivered','paid_demo').vOrder('order1234');
 assert.ok(html.includes('תשלום הדמו אושר'));assert.ok(html.includes('לא בוצע חיוב אמיתי'));
 const cash=await context('delivered').vOrder('order1234');assert.ok(!cash.includes('תשלום הדמו אושר'));
});
test('checkout explains immediate demo approval before submission',()=>{
 const s=fs.readFileSync('public/js/checkout.js','utf8');assert.ok(s.includes('שליחת ההזמנה תאשר גם את תשלום הדמו'));
});
test('public demo payment confirmation remains explicitly demo',async()=>{
 const sb={api:async()=>({order:{id:'1',short:'1',payment_status:'paid_demo',tenant_name:'בדיקה',total:70}}),esc:String,onAct(){}};
 vm.createContext(sb);vm.runInContext(fs.readFileSync('public/js/pay.js','utf8'),sb);
 const html=await sb.vPay('1');assert.ok(html.includes('תשלום הדמו אושר'));assert.ok(html.includes('לא בוצע חיוב אמיתי'));
});
