process.env.NODE_ENV = 'test';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {startApp, TEST_DB}=require('./helpers');
const {Pool}=require('pg');
test('T66 private books and T42 source entry guard',async t=>{
 const {api,schema}=await startApp(t);
 const pool=new Pool({connectionString:TEST_DB,options:`-c search_path=${schema},public`});
 t.after(()=>pool.end());
 const owner=await api.login('+972500000003');
 const admin=await api.login('+972500000001');
 const B='/api/t/achuza/bookkeeping';
 const {rows:[u]}=await pool.query("SELECT role FROM users WHERE phone='+972500000001'");
 assert.equal(u.role,'admin');
 for(const path of ['/trial-balance','/entries','/accountant-export.csv','/uniform-export/00000000-0000-0000-0000-000000000000/ini']){
  assert.equal((await api(B+path,{token:admin})).status,403,path);
 }
 assert.equal((await api(B+'/entries',{token:owner})).status,200);
 for(const source of ['invoice','expense','bank']){
  const {rows:[e]}=await pool.query("INSERT INTO bk_entries(tenant_id,entry_no,entry_date,description,source) SELECT id,$1,CURRENT_DATE,'guard',$2 FROM tenants WHERE slug='achuza' RETURNING id",[900+['invoice','expense','bank'].indexOf(source),source]);
  const r=await api(B+'/entries/'+e.id+'/reverse',{method:'POST',token:owner});
  assert.equal(r.status,409);assert.equal(r.json.code,'USE_SOURCE_REVERSAL');
  assert.equal((await pool.query('SELECT id FROM bk_entries WHERE reversal_of=$1',[e.id])).rowCount,0);
 }
});
