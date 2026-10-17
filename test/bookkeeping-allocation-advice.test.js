process.env.NODE_ENV='test';
const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/laundry_test';
const {allocationAdvice}=require('../src/routes/bookkeeping');
const {startApp,TEST_DB}=require('./helpers');const {Pool}=require('pg');
test('T44: date boundaries, strict net comparison and explicit customer type',()=>{
 for(const [date,threshold] of [['2025-01-01',20000],['2025-12-31',20000],['2026-01-01',10000],['2026-05-31',10000],['2026-06-01',5000]]){
  const doc={kind:'tax_invoice',customer_dealer_type:'morasha',amount_net:threshold};
  assert.equal(allocationAdvice(doc,date).allocation_recommended,false);
  doc.amount_net+=0.01;assert.equal(allocationAdvice(doc,date).allocation_recommended,true);
  for(const type of [null,'patur','private'])assert.equal(allocationAdvice({...doc,customer_dealer_type:type},date).allocation_recommended,false);
  assert.equal(allocationAdvice({...doc,kind:'receipt'},date).allocation_recommended,false);
  assert.equal(allocationAdvice({...doc,allocation_number:'123456789'},date).allocation_warning,null);
 }
});
test('T44: qualifying draft can issue without allocation and returns warning',async t=>{
 const {api,schema}=await startApp(t);const token=await api.login('+972500000003');const B='/api/t/achuza/bookkeeping';
 const pool=new Pool({connectionString:TEST_DB,options:`-c search_path=${schema},public`});t.after(()=>pool.end());
 await pool.query("UPDATE tenants SET dealer_type='morasha' WHERE slug='achuza'");await api(B+'/init',{method:'POST',token});
 const r=await api(B+'/documents',{method:'POST',token,body:{kind:'tax_invoice',customer_name:'מסמך דמו',customer_dealer_type:'morasha',amount_net:25000,vat_amount:4500}});
 assert.equal(r.status,201,JSON.stringify(r.json));assert.equal(r.json.document.allocation_recommended,true);
 const id=r.json.document.id;const issued=await api(B+'/documents/'+id+'/issue',{method:'POST',token});
 assert.equal(issued.status,200,JSON.stringify(issued.json));assert.ok(issued.json.allocation_warning);
 const d=(await api(B+'/documents',{token})).json.documents.find(x=>x.id===id);assert.equal(d.allocation_verification_status,'not_provided');assert.ok(d.allocation_warning);
});
