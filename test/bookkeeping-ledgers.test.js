process.env.NODE_ENV='test';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {startApp,TEST_DB}=require('./helpers');const {Pool}=require('pg');
test('T47 T57 T69 T14: opening movement closing, balance sheet, FIFO aging, PDF and tenant isolation',async t=>{
 const {api,schema,base}=await startApp(t);const token=await api.login('+972500000003');const B='/api/t/achuza/bookkeeping';
 const pool=new Pool({connectionString:TEST_DB,options:`-c search_path=${schema},public`});t.after(()=>pool.end());
 await api(B+'/init',{method:'POST',token});
 const party=(await api(B+'/parties',{method:'POST',token,body:{kind:'customer',name:'לקוח מסמך דמו'}})).json.party.id;
 const entry=async(date,debit,credit,amount)=>{
  const r=await api(B+'/entries',{method:'POST',token,body:{entry_date:date,description:'בדיקת כרטסת',lines:[{account_code:debit,party_id:party,debit:amount},{account_code:credit,credit:amount,party_id:party}]}});assert.equal(r.status,201,JSON.stringify(r.json));
 };
 await entry('2026-01-01','1020','4000',1000);
 await entry('2026-04-15','1000','1020',300);
 await entry('2026-06-01','1020','4000',500);
 const ledger=await api(B+'/parties/'+party+'/ledger?from=2026-04-01&to=2026-06-15',{token});assert.equal(ledger.status,200,JSON.stringify(ledger.json));
 assert.equal(ledger.json.opening_balance,'1000.00');assert.equal(ledger.json.closing_balance,'1200.00');assert.equal(ledger.json.movements.length,2);
 assert.equal(ledger.json.movements[0].running_balance,'700.00');assert.equal(ledger.json.aging.buckets.over_90,'700.00');assert.equal(ledger.json.aging.buckets['0_30'],'500.00');
 const account=(await api(B+'/accounts/1020/ledger?from=2026-04-01&to=2026-06-15',{token})).json;assert.equal(account.closing_balance,'1200.00');
 const tb=(await api(B+'/trial-balance?from=2026-04-01&to=2026-06-15',{token})).json;const a=tb.accounts.find(a=>a.code==='1020');assert.equal(a.opening_balance,'1000.00');assert.equal(a.debit,'500.00');assert.equal(a.credit,'300.00');assert.equal(a.closing_balance,'1200.00');assert.equal(tb.totals.balanced,true);assert.ok(tb.accounts.some(a=>a.code==='5000'));
 const bs=(await api(B+'/reports/balance-sheet?to=2026-06-15',{token})).json;assert.equal(bs.totals.assets,'1500.00');assert.equal(bs.totals.equity,'1500.00');assert.equal(bs.totals.balanced,true);
 assert.equal((await api(B+'/parties/'+party+'/ledger?from=2026-07-01&to=2026-06-01',{token})).status,400);
 const doc=await api(B+'/documents',{method:'POST',token,body:{kind:'invoice',customer_name:'לקוח מסמך דמו',amount_net:25,vat_amount:0}});const id=doc.json.document.id;
 assert.equal((await api(B+'/documents/'+id+'/pdf',{token})).status,409);
 await api(B+'/documents/'+id+'/issue',{method:'POST',token});
 const r=await fetch(base+B+'/documents/'+id+'/pdf',{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/pdf/);const buf=Buffer.from(await r.arrayBuffer());assert.equal(buf.subarray(0,5).toString(),'%PDF-');require('node:fs').writeFileSync('/tmp/bk-pdf-test.pdf',buf);
 const customer=await api.login('+972500000002');for(const path of ['/parties/'+party+'/ledger','/accounts/1020/ledger','/reports/balance-sheet','/documents/'+id+'/pdf'])assert.equal((await api(B+path,{token:customer})).status,403);
});
