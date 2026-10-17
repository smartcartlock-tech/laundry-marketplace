const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startApp, TEST_DB } = require('./helpers');

test('T84: one transactional inbox delivery, prefs, cancellation, hooks and tenant isolation', async t => {
  const { api, schema } = await startApp(t);
  process.env.DATABASE_URL = TEST_DB; process.env.PGSCHEMA = schema;
  const { q, pool } = require('../src/db');
  const { enqueue, deliverTenant, scheduleHooks } = require('../src/reminders');
  t.after(() => pool.end());
  const customer = await api.login('+972500000002');
  const other = await api.login('+972509999983');
  const { rows: users } = await q("SELECT id,phone FROM users WHERE phone IN ('+972500000002','+972509999983')");
  const uid = users.find(u=>u.phone.endsWith('002')).id;
  const oid = users.find(u=>u.phone.endsWith('983')).id;
  const { rows: tenants } = await q('SELECT id,slug FROM tenants ORDER BY created_at LIMIT 2');
  const [tenant, foreign] = tenants;
  const path = `/api/t/${tenant.slug}/reminders`;
  const makeOrder = async (status='ready', tid=tenant.id) => (await q(`INSERT INTO orders(tenant_id,customer_id,status,address,subtotal,total,pickup_at,delivery_at)
    VALUES($1,$2,$3,'test',10,10,now()+interval '1 day',now()+interval '2 days') RETURNING *`, [tid,uid,status])).rows[0];
  const order = await makeOrder();
  const due = new Date(Date.now()-60000).toISOString();
  assert.equal((await api(path)).status,401);
  const body = { order_id:order.id,kind:'order_ready',scheduled_at:due,idempotency_key:'once' };
  const created = await api(path,{method:'POST',token:customer,body});
  assert.equal(created.status,201,JSON.stringify(created.json));
  assert.equal((await api(path,{method:'POST',token:customer,body})).json.duplicate,true);
  assert.equal((await api(path,{method:'POST',token:other,body})).status,403);
  assert.equal((await api(`/api/t/${foreign.slug}/reminders`,{method:'POST',token:customer,body})).status,404);
  assert.equal((await api(path,{method:'POST',token:customer,body:{...body,scheduled_at:'garbage'}})).status,400);
  // Real outbound modules throw if invoked, even when provider env values exist.
  process.env.BOT_OUTBOUND_URL='https://must-never-call.invalid';process.env.BOT_OUTBOUND_KEY='test';
  process.env.TWILIO_ACCOUNT_SID='test';process.env.TWILIO_AUTH_TOKEN='test';process.env.INFORU_USERNAME='test';
  for(const [module,names] of [['notify',['notifyUser','sendWhatsApp','sendViaBot']],['push',['sendPushToUser']],['sms-inforu',['sendSms']]]) {
    const m=require('../src/'+module);for(const name of names) m[name]=()=>{throw new Error('EXTERNAL SEND '+name);};
  }
  const oldFetch=global.fetch;global.fetch=()=>{throw new Error('network forbidden during delivery');};
  try {
    const n=await Promise.all([deliverTenant(tenant.id),deliverTenant(tenant.id)]);
    assert.equal(n.reduce((a,b)=>a+b,0),1);
    assert.equal(await deliverTenant(tenant.id),0);
  } finally {global.fetch=oldFetch;}
  const inbox = await api('/api/messages',{token:customer});
  const msg = inbox.json.messages.filter(m=>m.data?.reminder_id===created.json.reminder.id);
  assert.equal(msg.length,1);assert.equal(msg[0].title,'ההזמנה מוכנה');assert.equal(msg[0].data.internal_only,true);
  assert.equal((await api('/api/messages',{token:other})).json.messages.some(m=>m.id===msg[0].id),false);
  assert.equal((await api(`/api/t/${foreign.slug}/reminders`,{token:customer})).json.reminders.length,0);
  const schedule = async (o,key,kind='order_ready',userId=uid, payload={}) => enqueue(q,{tenantId:tenant.id,userId,orderId:o.id,kind,scheduledAt:due,key,payload});
  // Opt-out status and order-message preferences are independently respected.
  for (const field of ['status_updates','order_messages']) {
    await q(`INSERT INTO user_notification_prefs(user_id,${field}) VALUES($1,false) ON CONFLICT(user_id) DO UPDATE SET ${field}=false`,[uid]);
    const reminder=await schedule(order,'mute-'+field);await deliverTenant(tenant.id);
    assert.equal((await q('SELECT status FROM reminder_outbox WHERE tenant_id=$1 AND id=$2',[tenant.id,reminder.id])).rows[0].status,'cancelled');
    await q(`UPDATE user_notification_prefs SET ${field}=true WHERE user_id=$1`,[uid]);
  }
  // Future reminders stay pending; quiet mode postpones rather than loses delivery.
  const future=await enqueue(q,{tenantId:tenant.id,userId:uid,orderId:order.id,kind:'order_ready',scheduledAt:new Date(Date.now()+3600000).toISOString(),key:'future'});
  await deliverTenant(tenant.id);
  assert.equal((await q('SELECT status FROM reminder_outbox WHERE tenant_id=$1 AND id=$2',[tenant.id,future.id])).rows[0].status,'pending');
  const shabbat=require('../src/shabbat'); const realQuiet=shabbat.isQuietTime;
  // Engine uses the real shared quiet-time function, tested via the current quiet state.
  await q('UPDATE user_notification_prefs SET quiet_shabbat=true WHERE user_id=$1',[uid]);
  const quiet=await schedule(order,'quiet');await deliverTenant(tenant.id);
  assert.equal((await q('SELECT status FROM reminder_outbox WHERE tenant_id=$1 AND id=$2',[tenant.id,quiet.id])).rows[0].status,realQuiet().quiet?'pending':'delivered');
  await q('UPDATE user_notification_prefs SET quiet_shabbat=false WHERE user_id=$1',[uid]);
  await deliverTenant(tenant.id);
  const cancelledOrder=await makeOrder();const cancelled=await schedule(cancelledOrder,'cancelled');
  await q("UPDATE orders SET status='cancelled' WHERE tenant_id=$1 AND id=$2",[tenant.id,cancelledOrder.id]);
  const deliveredOrder=await makeOrder();const stale=await schedule(deliveredOrder,'delivered');
  await q("UPDATE orders SET status='delivered' WHERE tenant_id=$1 AND id=$2",[tenant.id,deliveredOrder.id]);
  await deliverTenant(tenant.id);
  for(const id of [cancelled.id,stale.id]) assert.equal((await q('SELECT status FROM reminder_outbox WHERE tenant_id=$1 AND id=$2',[tenant.id,id])).rows[0].status,'cancelled');
  const pending=await api(path,{method:'POST',token:customer,body:{...body,idempotency_key:'cancel',scheduled_at:new Date(Date.now()+600000).toISOString()}});
  assert.equal((await api(`${path}/${pending.json.reminder.id}`,{method:'DELETE',token:other})).status,404);
  assert.equal((await api(`${path}/${pending.json.reminder.id}`,{method:'DELETE',token:customer})).status,200);
  const pickup=await makeOrder('confirmed');
  const {rows:cs}=await q('SELECT id,user_id FROM couriers WHERE approved=true LIMIT 1');
  await q('UPDATE orders SET courier_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,pickup.id,cs[0].id]);
  await scheduleHooks(q,tenant.id);await scheduleHooks(q,tenant.id);
  const {rows:hooks}=await q('SELECT kind,count(*)::int n FROM reminder_outbox WHERE tenant_id=$1 AND order_id=$2 GROUP BY kind',[tenant.id,pickup.id]);
  assert.equal(hooks.find(h=>h.kind==='pickup_tomorrow').n,1);assert.equal(hooks.find(h=>h.kind==='courier').n,1);
  // Reassignment invalidates an already queued courier reminder.
  const cr=await schedule(pickup,'courier-reassign','courier',cs[0].user_id,{event_at:pickup.pickup_at});
  await q('UPDATE orders SET courier_id=NULL WHERE tenant_id=$1 AND id=$2',[tenant.id,pickup.id]);
  await deliverTenant(tenant.id);
  assert.equal((await q('SELECT status FROM reminder_outbox WHERE tenant_id=$1 AND id=$2',[tenant.id,cr.id])).rows[0].status,'cancelled');
  // Existing 2-argument callers retain the same behavior.
  const legacy=await require('../src/usermessages').postUserMessage(uid,{tenantId:tenant.id,title:'legacy',body:'unchanged'});
  assert.ok(legacy.id);
  // Failure after inbox insert rolls both writes back, then the retry delivers once.
  const retry=await schedule(order,'rollback');
  const failingPool={async connect(){const c=await pool.connect();return {release:()=>c.release(),query:async(sql,args)=>{
    if(sql.includes("SET status='delivered'"))throw new Error('injected failure');return c.query(sql,args);
  }};}};
  await assert.rejects(deliverTenant(tenant.id,failingPool),/injected failure/);
  assert.equal((await q("SELECT count(*)::int n FROM user_messages WHERE tenant_id=$1 AND data->>'reminder_id'=$2",[tenant.id,retry.id])).rows[0].n,0);
  await deliverTenant(tenant.id);
  assert.equal((await q("SELECT count(*)::int n FROM user_messages WHERE tenant_id=$1 AND data->>'reminder_id'=$2",[tenant.id,retry.id])).rows[0].n,1);
});

test('T84: source-level safety, transport-free engine and demo gate',()=>{
  const source=fs.readFileSync(require.resolve('../src/reminders'),'utf8');
  assert.doesNotMatch(source,/require\(['"].*(?:notify|push|twilio|inforu|bot)/);
  assert.doesNotMatch(source,/\bfetch\s*\(|https?:\/\//);
  assert.match(source,/if \(!isDemo \|\| running\) return/);
  assert.match(source,/setInterval\(tick, 60000\)/);
});
