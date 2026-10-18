const test=require('node:test'),assert=require('node:assert/strict');const {startApp,TEST_DB}=require('./helpers');
test('T98: partial invoice refund follows receipt; cancellation paid demo; exempt dealer; no duplicate',async t=>{
 const {api,schema}=await startApp(t);process.env.DATABASE_URL=TEST_DB;process.env.PGSCHEMA=schema;
 const {q,pool}=require('../src/db');t.after(()=>pool.end());
 const owner=await api.login('+972500000003'),customer=await api.login('+972500000002');
 const item=(await api('/api/laundries/achuza')).json.items[0];
 const create=async()=>{const r=await api('/api/orders',{method:'POST',token:customer,body:{slug:'achuza',items:[{item_id:item.id,qty:1}],address:'T98',payment_method:'demo_online'}});assert.equal(r.status,201);return r.json.order;};
 for(const dealer_type of ['morasha','patur']){
 await api('/api/t/achuza/settings',{method:'PATCH',token:owner,body:{dealer_type,dealer_id:"512345678"}});
 const order=await create();
 const rec=(await q("SELECT * FROM documents WHERE tenant_id=$1 AND order_id=$2 AND kind='receipt'",[order.tenant_id,order.id])).rows[0];
 const c=await pool.connect();let inv;try{
 await c.query('BEGIN');await c.query("UPDATE orders SET status='delivered' WHERE tenant_id=$1 AND id=$2",[order.tenant_id,order.id]);
 const tenant=(await c.query('SELECT * FROM tenants WHERE id=$1',[order.tenant_id])).rows[0];
 [inv]=await require('../src/documents').issueDocumentsForOrder(c,{tenant,order});await c.query('COMMIT');
 }finally{c.release();}
 const partial=await api(`/api/t/achuza/documents/${inv.id}/credit`,{method:'POST',token:owner,body:{amount:10}});assert.equal(partial.status,201,JSON.stringify(partial.json));
 const after=(await q('SELECT * FROM documents WHERE tenant_id=$1 AND id=$2',[order.tenant_id,rec.id])).rows[0];
 assert.equal(Number(after.credited_amount),10);assert.equal(after.status,'partially_credited');assert.equal(Number(after.total),Number(order.total));
 assert.equal(partial.json.credit.receipt_credits.length,1);
 if(dealer_type==='patur'){assert.equal(partial.json.credit.title_he,'זיכוי לחשבונית עסקה (דמו)');assert.equal(Number(partial.json.credit.vat),0);}
 const full=await api(`/api/t/achuza/documents/${inv.id}/credit`,{method:'POST',token:owner,body:{}});assert.equal(full.status,201);
 const refunds=(await q('SELECT sum(amount)::numeric n FROM demo_document_refunds WHERE tenant_id=$1 AND order_id=$2',[order.tenant_id,order.id])).rows[0];assert.equal(Number(refunds.n),Number(order.total));
 assert.equal((await api(`/api/t/achuza/documents/${inv.id}/credit`,{method:'POST',token:owner,body:{}})).status,409);
 const balances=await q('SELECT a.code,sum(l.debit-l.credit)::numeric n FROM bk_lines l JOIN bk_accounts a ON a.id=l.account_id AND a.tenant_id=l.tenant_id WHERE l.tenant_id=$1 GROUP BY a.code',[order.tenant_id]);for(const b of balances.rows)assert.equal(Number(b.n),0);
 const cancelled=await create();const cancel=await api(`/api/orders/${cancelled.id}/cancel`,{method:'POST',token:customer,body:{}});assert.equal(cancel.status,200,JSON.stringify(cancel.json));
 assert.equal(Number((await q('SELECT demo_refunded_amount FROM orders WHERE tenant_id=$1 AND id=$2',[cancelled.tenant_id,cancelled.id])).rows[0].demo_refunded_amount),Number(cancelled.total));
 assert.equal((await api(`/api/orders/${cancelled.id}/cancel`,{method:'POST',token:customer,body:{}})).status,409);
 }
});
