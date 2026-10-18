const test=require('node:test'),assert=require('node:assert/strict');
const {Pool}=require('pg');const {TEST_DB}=require('./helpers');
const schema='test_bridge_'+Math.random().toString(36).slice(2,8);
const pool=new Pool({connectionString:TEST_DB,options:`-c search_path=${schema},public`});
test('T97: balanced invoice+receipt; credit; concurrency; closed period; isolation',async t=>{
 t.after(async()=>{await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();});
 await pool.query(`CREATE SCHEMA ${schema}`);await require('../src/migrate').runMigrations(pool,schema);
 const user=(await pool.query("INSERT INTO users(phone,name) VALUES('+972509999777','bridge') RETURNING *")).rows[0];
 const makeTenant=async slug=>(await pool.query("INSERT INTO tenants(slug,name,dealer_type) VALUES($1,$1,'morasha') RETURNING *",[slug])).rows[0];
 const tenant=await makeTenant('bridge'),foreign=await makeTenant('foreign');
 const {issueDocument,creditDocument}=require('../src/documents');const {postOrderDocument}=require('../src/order-document-ledger');
 const c=await pool.connect();let invoice,receipt;
 try{
 await c.query('BEGIN');invoice=await issueDocument(c,{tenant,kind:'invoice',customer:user,amount:72.03,vat:12.97,total:85});
 receipt=await issueDocument(c,{tenant,kind:'receipt',customer:user,amount:85,vat:0,total:85});await c.query('COMMIT');
 }finally{c.release();}
 const sums=async()=> (await pool.query(`SELECT a.code,sum(l.debit)::numeric debit,sum(l.credit)::numeric credit FROM bk_lines l JOIN bk_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id WHERE l.tenant_id=$1 GROUP BY a.code`,[tenant.id])).rows;
 let rows=await sums();const by=code=>rows.find(x=>x.code===code);
 assert.equal(Number(by('2010').credit),12.97);assert.equal(Number(by('4000').credit),72.03);assert.equal(Number(by('1020').debit),Number(by('1020').credit));
 await Promise.all(Array.from({length:3},async()=>{const c=await pool.connect();try{await c.query('BEGIN');await postOrderDocument(c,{tenant,document:invoice});await c.query('COMMIT');}finally{c.release();}}));
 assert.equal((await pool.query('SELECT count(*)::int n FROM bk_order_document_entries WHERE tenant_id=$1',[tenant.id])).rows[0].n,2);
 const cr=await pool.connect();try{
 await cr.query('BEGIN');await creditDocument(cr,{tenant,original:invoice,amount:10,actorId:user.id});await cr.query('COMMIT');
 }finally{cr.release();}
 rows=await sums();assert.equal(Number(by('4000').credit)-Number(by('4000').debit),63.56);
 const balanced=await pool.query('SELECT entry_id FROM bk_lines WHERE tenant_id=$1 GROUP BY entry_id HAVING sum(debit)<>sum(credit)',[tenant.id]);assert.equal(balanced.rows.length,0);
 const cx=await pool.connect();try{await cx.query('BEGIN');await assert.rejects(postOrderDocument(cx,{tenant:foreign,document:invoice}),e=>e.status===409);await cx.query('ROLLBACK');}finally{cx.release();}
 assert.equal((await pool.query('SELECT count(*)::int n FROM bk_entries WHERE tenant_id=$1',[foreign.id])).rows[0].n,0);
 await pool.query("INSERT INTO bk_periods(tenant_id,year,month) VALUES($1,extract(year from now() AT TIME ZONE 'Asia/Jerusalem'),extract(month from now() AT TIME ZONE 'Asia/Jerusalem'))",[tenant.id]);
 const cc=await pool.connect();try{await cc.query('BEGIN');await assert.rejects(issueDocument(cc,{tenant,kind:'invoice',customer:user,amount:1,vat:.18,total:1.18}),e=>e.status===409);await cc.query('ROLLBACK');}finally{cc.release();}
});
