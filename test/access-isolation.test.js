const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

test('access isolation: foreign order, address, business account and tenant operations are denied', async t => {
  const { api, schema } = await startApp(t);
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const stranger = await api.login('+972500000088', 'QA isolation');
  await api('/api/auth/consent', { method:'POST', token:customer, body:{accepted:true} });
  const item = (await api('/api/laundries/express')).json.items[0];
  const made = await api('/api/orders', { method:'POST', token:customer, body:{slug:'express',items:[{item_id:item.id,qty:10}],address:'QA demo address'} });
  assert.equal(made.status,201);
  const id = made.json.order.id;
  for(const token of [owner,stranger]) {
    for(const path of [`/api/orders/${id}`, `/api/orders/${id}/receipt.pdf`]) {
      assert.equal((await api(path,{token})).status,403,path);
    }
  }
  for(const [method,path,body] of [
    ['POST',`/api/t/achuza/orders/${id}/status`,{status:'confirmed'}],
    ['GET',`/api/t/achuza/orders/${id}/label.pdf`],
    ['POST',`/api/orders/${id}/cancel`,{}],
    ['POST',`/api/orders/${id}/report`,{kind:'other',text:'QA demo'}],
  ]) {
    const result = await api(path,{method,token:owner,body});
    assert.ok([403,404].includes(result.status),`${method} ${path}: ${result.status}`);
  }
  assert.equal((await db.query('SELECT status FROM orders WHERE id=$1',[id])).rows[0].status,'new');
  const saved = await api('/api/addresses', {method:'POST',token:customer,body:{address:'QA saved demo address'}});
  assert.equal(saved.status,201);
  assert.equal((await api('/api/addresses/'+saved.json.address.id,{method:'DELETE',token:stranger})).status,404);
  assert.ok((await api('/api/addresses',{token:customer})).json.addresses.some(a=>a.id===saved.json.address.id));
  const admin = await api.login('+972500000001');
  const foreignAccount = (await api('/api/t/express/business-accounts',{method:'POST',token:admin,body:{name:'QA isolated demo account'}})).json.account;
  for(const [method,suffix,body] of [['GET',''],['PATCH','',{name:'not allowed'}],['DELETE',''],['GET','/invoices'],['PUT','/prices',{prices:[]}],['POST','/users',{phone:'+972500000002'}]]) {
    assert.equal((await api(`/api/t/achuza/business-accounts/${foreignAccount.id}${suffix}`,{method,token:owner,body})).status,404);
  }
  const report = await api(`/api/orders/${id}/report`, {method:'POST',token:customer,body:{kind:'other',text:'QA demo report',photos:[{content_type:'image/png',data_b64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='}]}});
  assert.equal(report.status,201);
  const pid = (await db.query('SELECT id FROM issue_report_photos WHERE report_id=$1',[report.json.report.id])).rows[0].id;
  for(const token of [owner,stranger]) assert.equal((await api('/api/issue-photos/'+pid,{token})).status,403);
  assert.equal((await api(`/api/t/achuza/issues/${report.json.report.id}/handle`,{method:'POST',token:owner,body:{status:'resolved'}})).status,404);
  const {issueDocument}=require('../src/documents');
  const tenant=(await db.query("SELECT * FROM tenants WHERE slug='express'")).rows[0];
  const doc=await issueDocument(db,{tenant,kind:'receipt',order:{id},customer:{id:made.json.order.customer_id},amount:100,vat:0,total:100});
  for(const token of [owner,stranger]) assert.equal((await api(`/api/documents/${doc.id}/pdf`,{token})).status,403);
  for(const [method,suffix,body] of [['GET','pdf'],['POST','credit',{}]]) assert.equal((await api(`/api/t/achuza/documents/${doc.id}/${suffix}`,{method,token:owner,body})).status,404);
  assert.equal((await db.query('SELECT credited_amount FROM documents WHERE id=$1',[doc.id])).rows[0].credited_amount,'0.00');
  for(const path of ['/api/admin/overview','/api/admin/export','/api/admin/errors','/api/t/express/settings','/api/t/express/orders','/api/t/express/issues','/api/t/express/checklist']) {
    assert.equal((await api(path,{token:owner})).status,403,path);
  }
});
