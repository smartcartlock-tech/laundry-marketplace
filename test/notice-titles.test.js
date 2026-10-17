const test=require('node:test');
const assert=require('node:assert/strict');
const {startApp}=require('./helpers');
test('T33: status notice has tracking code and status in its title',async t=>{
 const {api}=await startApp(t);
 const c=await api.login('+972500000002'), owner=await api.login('+972500000003');
 const p=await api('/api/laundries/achuza');
 const order=(await api('/api/orders',{method:'POST',token:c,body:{slug:'achuza',address:'דמו',items:[{item_id:p.json.items.find(x=>x.name.includes('שק')).id,qty:1}]}})).json.order;
 assert.equal((await api(`/api/t/achuza/orders/${order.id}/status`,{method:'POST',token:owner,body:{status:'confirmed'}})).status,200);
 await new Promise(r=>setTimeout(r,700));
 const msgs=(await api('/api/messages',{token:c})).json.messages;
 assert.ok(msgs.some(m=>m.title.includes(order.tracking_code)&&m.title.includes('אושרה')));
});
