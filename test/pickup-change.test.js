const test=require('node:test');
const assert=require('node:assert/strict');
const {startApp,TEST_DB}=require('./helpers');
const {Client}=require('pg');

test('T25/T26 configured pickup slots, owner/courier notices and isolation',async t=>{
 const {api,schema}=await startApp(t);
 const customer=await api.login('+972500000002'),owner=await api.login('+972500000003');
 const courier=await api.login('+972500000004'),other=await api.login('+972500000099');
 const page=await api('/api/laundries/achuza');
 const bag=page.json.items.find(x=>x.name.includes('שק'));
 const created=await api('/api/orders',{method:'POST',token:customer,body:{slug:'achuza',items:[{item_id:bag.id,qty:1}],address:'דמו'}});
 assert.equal(created.status,201);
 const o=created.json.order;
 const url='/api/orders/'+o.id;
 assert.equal((await api(url+'/pickup-options',{token:other})).status,404);
 assert.equal((await api(url+'/pickup',{method:'POST',token:other,body:{pickup_at:new Date(Date.now()+86400000).toISOString()}})).status,404);
 const slots=(await api(url+'/pickup-options',{token:customer})).json.options;
 assert.ok(slots.length);
 assert.equal((await api(url+'/pickup',{method:'POST',token:customer,body:{pickup_at:'invalid'}})).status,400);
 assert.equal((await api(url+'/pickup',{method:'POST',token:customer,body:{pickup_at:new Date(Date.now()+12345678).toISOString()}})).status,409);
 await api('/api/t/achuza/orders/'+o.id+'/status',{method:'POST',token:owner,body:{status:'confirmed'}});
 const cs=(await api('/api/t/achuza/couriers',{token:owner})).json.couriers;
 await api('/api/t/achuza/orders/'+o.id+'/assign',{method:'POST',token:owner,body:{courier_id:cs.find(x=>x.model==='private').id}});
 const changed=await api(url+'/pickup',{method:'POST',token:customer,body:{pickup_at:slots[0].at}});
 assert.equal(changed.status,200,JSON.stringify(changed.json));
 assert.equal(new Date(changed.json.pickup_at).toISOString(),slots[0].at);
 await new Promise(r=>setTimeout(r,1000));
 for(const token of [owner,courier]){
  const m=await api('/api/messages',{token});
  assert.ok(m.json.messages.some(x=>x.body.includes(o.tracking_code)&&x.body.includes('חלון האיסוף')),'notice for owner and assigned courier');
 }
 // Closure invalidates previously offered slots. No manual production writes.
 const db=new Client({connectionString:TEST_DB,options:`-c search_path=${schema}`});await db.connect();
 t.after(()=>db.end());
 await db.query("INSERT INTO tenant_closures(tenant_id,day) VALUES($1,($2::timestamptz AT TIME ZONE 'Asia/Jerusalem')::date)",[o.tenant_id,slots[1].at]);
 assert.equal((await api(url+'/pickup',{method:'POST',token:customer,body:{pickup_at:slots[1].at}})).status,409);
 await api('/api/courier/orders/'+o.id+'/mark',{method:'POST',token:courier,body:{action:'picked_up'}});
 assert.equal((await api(url+'/pickup',{method:'POST',token:customer,body:{pickup_at:slots[2].at}})).status,409);
});
