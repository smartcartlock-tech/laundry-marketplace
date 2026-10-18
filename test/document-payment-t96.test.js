const test=require('node:test'),assert=require('node:assert/strict');
const {startApp,TEST_DB}=require('./helpers');
test('T96: dealer snapshot; receipt only at collection; late payment and replay',async t=>{
 const {api,schema,base}=await startApp(t);
 process.env.DATABASE_URL=TEST_DB;process.env.PGSCHEMA=schema;
 const {q,pool}=require('../src/db');t.after(()=>pool.end());
 const owner=await api.login('+972500000003'),customer=await api.login('+972500000002');
 const tenant=(await q("SELECT * FROM tenants WHERE slug='achuza'")).rows[0];
 const uid=(await q("SELECT id FROM users WHERE phone='+972500000002'")).rows[0].id;
 const item=(await api('/api/laundries/achuza')).json.items[0];
 const create=async(method='cash')=>api('/api/orders',{method:'POST',token:customer,body:{slug:'achuza',items:[{item_id:item.id,qty:1}],address:'T96 test',payment_method:method}});
 await q("UPDATE tenants SET dealer_type='patur' WHERE id=$1",[tenant.id]);
 const unpaid=(await create()).json.order;
 assert.equal((await q('SELECT count(*)::int n FROM documents WHERE tenant_id=$1 AND order_id=$2',[tenant.id,unpaid.id])).rows[0].n,0);
 const client=await pool.connect();try{
  await client.query('BEGIN');await client.query("UPDATE orders SET status='delivered' WHERE tenant_id=$1 AND id=$2",[tenant.id,unpaid.id]);
  await require('../src/documents').issueDocumentsForOrder(client,{tenant:{...tenant,dealer_type:'patur'},order:unpaid});await client.query('COMMIT');
 }finally{client.release();}
 let docs=(await q('SELECT * FROM documents WHERE tenant_id=$1 AND order_id=$2',[tenant.id,unpaid.id])).rows;
 assert.equal(docs.length,1);assert.equal(docs[0].kind,'invoice');assert.equal(docs[0].title_he,'חשבונית עסקה');assert.equal(Number(docs[0].vat),0);
 assert.equal((await api(`/api/pay/${unpaid.id}/confirm`,{method:'POST',body:{}})).status,200);
 docs=(await q('SELECT * FROM documents WHERE tenant_id=$1 AND order_id=$2',[tenant.id,unpaid.id])).rows;
 assert.equal(docs.length,2);assert.equal(docs.filter(d=>d.kind==='receipt').length,1);
 assert.equal((await api(`/api/pay/${unpaid.id}/confirm`,{method:'POST',body:{}})).status,409);
 const paid=await create('demo_online');assert.equal(paid.status,201,JSON.stringify(paid.json));
 docs=(await q('SELECT * FROM documents WHERE tenant_id=$1 AND order_id=$2',[tenant.id,paid.json.order.id])).rows;
 assert.deepEqual(docs.map(d=>d.kind),['receipt']);
 await assert.rejects(q('UPDATE documents SET title_he=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,docs[0].id,'rewritten']),/immutable/);
 // Existing originals never change when dealer settings change.
 await q("UPDATE tenants SET dealer_type='morasha' WHERE id=$1",[tenant.id]);
 const mine=await api('/api/documents/mine',{token:customer});
 assert.equal(mine.json.documents.find(d=>d.order_id===unpaid.id&&d.kind==='invoice').kind_he,'חשבונית עסקה');
 const c=await pool.connect();try{
 await c.query('BEGIN');await c.query("UPDATE orders SET status='delivered' WHERE tenant_id=$1 AND id=$2",[tenant.id,paid.json.order.id]);
 const issued=await require('../src/documents').issueDocumentsForOrder(c,{tenant:{...tenant,dealer_type:'morasha'},order:paid.json.order});
 assert.equal(issued.length,1);assert.equal(issued[0].title_he,'חשבונית מס');
 require('fs').writeFileSync('/tmp/t96-tax-invoice.pdf',issued[0].pdf);await c.query('COMMIT');
 }finally{c.release();}
});
