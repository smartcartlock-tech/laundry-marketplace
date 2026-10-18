const test=require('node:test'),assert=require('node:assert/strict');const {startApp,TEST_DB}=require('./helpers');
test('T99: subscription charge signed once; consolidated delivered orders in immutable series',async t=>{
 const {api,schema}=await startApp(t);process.env.DATABASE_URL=TEST_DB;process.env.PGSCHEMA=schema;
 const {q,pool}=require('../src/db');t.after(()=>pool.end());
 const owner=await api.login('+972500000003'),customer=await api.login('+972500000002');
 await api('/api/t/achuza/settings',{method:'PATCH',token:owner,body:{dealer_type:'morasha',dealer_id:'512345678'}});
 const tenant=(await q("SELECT * FROM tenants WHERE slug='achuza'")).rows[0];
 const plan=(await api('/api/subscriptions/plans/achuza',{token:customer})).json.plans[0];
 const join=await api('/api/subscriptions/join',{method:'POST',token:customer,body:{slug:'achuza',plan_id:plan.id}});assert.equal(join.status,201,JSON.stringify(join.json));
 assert.ok(join.json.document_charge.invoice_id);assert.ok(join.json.document_charge.receipt_id);
 const c=await pool.connect();try{await c.query('BEGIN');const again=await require('../src/billing-documents').subscriptionCharge(c,join.json.subscription);assert.equal(again.invoice_id,join.json.document_charge.invoice_id);await c.query('COMMIT');}finally{c.release();}
 let docs=(await q('SELECT * FROM documents WHERE tenant_id=$1 AND id=ANY($2)',[tenant.id,[join.json.document_charge.invoice_id,join.json.document_charge.receipt_id]])).rows;
 assert.equal(docs.length,2);for(const d of docs){assert.ok(d.signature);assert.ok(d.sha256);assert.ok(d.pdf.length>1000);}
 const account=(await api('/api/t/achuza/business-accounts',{method:'POST',token:owner,body:{name:'T99 business'}})).json.account;
 const uid=join.json.subscription.user_id;
 const orders=[];for(let i=0;i<2;i++)orders.push((await q(`INSERT INTO orders(tenant_id,customer_id,business_account_id,status,address,subtotal,total) VALUES($1,$2,$3,'delivered','T99',85,85) RETURNING *`,[tenant.id,uid,account.id])).rows[0]);
 const year=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Jerusalem',year:'numeric'}).format(new Date())),month=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Jerusalem',month:'numeric'}).format(new Date()));
 const generate=()=>api(`/api/t/achuza/business-accounts/${account.id}/invoices/generate`,{method:'POST',token:owner,body:{year,month}});
 const g=await generate();assert.equal(g.status,200,JSON.stringify(g.json));assert.ok(g.json.invoice.fiscal_document_id);
 const d=(await q('SELECT * FROM documents WHERE tenant_id=$1 AND id=$2',[tenant.id,g.json.invoice.fiscal_document_id])).rows[0];assert.equal(Number(d.total),170);assert.equal(d.title_he,'חשבונית מס מרכזת');assert.ok(d.signature);
 assert.equal((await q('SELECT count(*)::int n FROM document_orders WHERE document_id=$1',[d.id])).rows[0].n,2);
 assert.equal((await generate()).json.invoice.fiscal_document_id,d.id);
 await assert.rejects(q('UPDATE documents SET total=1 WHERE tenant_id=$1 AND id=$2',[tenant.id,d.id]),/immutable/);
 require('fs').writeFileSync('/tmp/t99-consolidated.pdf',d.pdf);
});
