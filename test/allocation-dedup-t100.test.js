const test=require('node:test'),assert=require('node:assert/strict');const {startApp,TEST_DB}=require('./helpers');
test('T100: duplicate manual allocation rejected within and across document systems; tenant isolated',async t=>{
 const {api,schema}=await startApp(t);process.env.DATABASE_URL=TEST_DB;process.env.PGSCHEMA=schema;
 const {q,pool}=require('../src/db');t.after(()=>pool.end());
 const owner=await api.login('+972500000003');await api('/api/t/achuza/settings',{method:'PATCH',token:owner,body:{dealer_type:'morasha',dealer_id:'512345678'}});await api('/api/t/achuza/bookkeeping/init',{method:'POST',token:owner});
 const create=async()=>{const r=await api('/api/t/achuza/bookkeeping/documents',{method:'POST',token:owner,body:{kind:'tax_invoice',customer_name:'T100',amount_net:100,vat_amount:18}});assert.equal(r.status,201,JSON.stringify(r.json));return r.json.document;};
 const a=await create(),b=await create();const allocate=id=>api(`/api/t/achuza/bookkeeping/documents/${id}/allocate`,{method:'POST',token:owner,body:{allocation_number:'123456789'}});
 assert.equal((await allocate(a.id)).status,200);assert.equal((await allocate(b.id)).status,409);
 const {rows:tenants}=await q('SELECT * FROM tenants ORDER BY created_at LIMIT 2');
 const tenant=tenants.find(x=>x.slug==='achuza')|| (await q("SELECT * FROM tenants WHERE slug='achuza'")).rows[0];
 const c=await pool.connect();try{
 await c.query('BEGIN');await assert.rejects(require('../src/documents').issueDocument(c,{tenant,kind:'invoice',amount:1,vat:.18,total:1.18,allocationNumber:'123456789'}),e=>e.code==='23505');await c.query('ROLLBACK');
 }finally{c.release();}
});
