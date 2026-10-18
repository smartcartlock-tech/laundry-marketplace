const test=require('node:test'),assert=require('node:assert/strict');const {startApp,TEST_DB}=require('./helpers');
test('T101: review, close, posting block, reopen reason and tenant ownership',async t=>{
 const {api,schema}=await startApp(t);process.env.DATABASE_URL=TEST_DB;process.env.PGSCHEMA=schema;
 const {q,pool}=require('../src/db');t.after(()=>pool.end());
 const owner=await api.login('+972500000003'),customer=await api.login('+972500000002');const B='/api/t/achuza/bookkeeping';
 await api(B+'/init',{method:'POST',token:owner});
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date());const [year,month]=date.split('-').map(Number);
 const journal={entry_date:date,description:'T101 close',lines:[{account_code:'1000',debit:20},{account_code:'4000',credit:20}]};
 assert.equal((await api(B+'/entries',{method:'POST',token:owner,body:journal})).status,201);
 let review=await api(B+`/periods/summary?year=${year}&month=${month}`,{token:owner});assert.equal(review.status,200);assert.equal(review.json.balanced,true);assert.equal(review.json.sequence_ok,true);assert.equal(review.json.totals.debit,'20.00');
 assert.equal((await api(B+'/periods/close',{method:'POST',token:customer,body:{year,month}})).status,403);
 assert.equal((await api(B+'/periods/close',{method:'POST',token:owner,body:{year,month}})).status,201);
 assert.equal((await api(B+'/entries',{method:'POST',token:owner,body:journal})).status,400);
 assert.equal((await api(B+'/periods/reopen',{method:'POST',token:owner,body:{year,month}})).status,400);
 assert.equal((await api(B+'/periods/reopen',{method:'POST',token:owner,body:{year,month,reason:'תיקון טעות'}})).status,200);
 assert.equal((await api(B+'/entries',{method:'POST',token:owner,body:journal})).status,201);
 const audits=(await q("SELECT action FROM audit_log WHERE action IN ('bk_period_close','bk_period_reopen')")).rows;assert.equal(audits.length,2);
 assert.equal((await api(B+'/periods/summary?year=2026&month=13',{token:owner})).status,400);
});
