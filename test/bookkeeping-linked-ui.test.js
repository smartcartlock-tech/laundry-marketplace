const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const src=fs.readFileSync('public/js/bookkeeping.js','utf8');
function setup(){
 const handlers=[]; const posts=[]; const source={id:'source',kind:'tax_invoice',doc_year:2026,doc_number:3,status:'issued',customer_name:'לקוח דמו',amount_net:'100',vat_amount:'18',total:'118',paid_amount:'20',allocation_number:'123456789',allocation_verification_status:'manual_unverified'};
 const sb={window:{vManage:async()=>'<div class="subtabs"></div>'},document:{addEventListener:(t,f)=>handlers.push(f)},state:{memberships:[{slug:'x',role:'owner'}]},store:{get:()=> 'x'},esc:String,toast:()=>{},route:()=>{},xconfirm:async()=>true,xmodal:async()=>({amount:'40'}),api:async(p,o)=>{if(o){posts.push([p,JSON.parse(o.body)]);return {}}if(p.endsWith('/documents'))return {documents:[source]};throw Error(p)}};
 vm.createContext(sb);vm.runInContext(src,sb);
 const click=async act=>handlers[0]({target:{closest:()=>({getAttribute:k=>k==='data-bk-act'?act:'source'})}});
 return {sb,posts,click,source};
}
test('linked receipt sends total payment with zero VAT and source id',async()=>{
 const {posts,click}=setup();await click('source-receipt');
 assert.equal(posts.length,1);assert.equal(posts[0][1].kind,'receipt');assert.equal(posts[0][1].amount_net,40);assert.equal(posts[0][1].vat_amount,0);assert.equal(posts[0][1].source_document_id,'source');
});
test('full credit copies source net and VAT, creates draft only',async()=>{
 const {posts,click}=setup();await click('source-credit');assert.equal(posts.length,1);assert.equal(posts[0][1].kind,'credit_note');assert.equal(posts[0][1].amount_net,100);assert.equal(posts[0][1].vat_amount,18);
});
test('receipt over outstanding amount is rejected without write',async()=>{
 const {sb,posts,click}=setup();sb.xmodal=async()=>({amount:'99'});await click('source-receipt');assert.equal(posts.length,0);
});
test('fully credited source is not used',async()=>{
 const {source,posts,click}=setup();source.fully_credited=true;await click('source-credit');assert.equal(posts.length,0);
});
test('bimonth period computes leap February and tenant-specific key',async()=>{
 const {sb,click}=setup();let saved;
 sb.document.getElementById=id=>({value:({'bk-period-mode':'bimonth','bk-period-month':'2024-02'})[id]||''});
 sb.store.set=(k,v)=>{saved={k,v}};
 await click('period-preset');assert.equal(saved.k,'bkPeriod_x');assert.equal(saved.v.from,'2024-01-01');assert.equal(saved.v.to,'2024-02-29');
});
test('month range correctly ends in December, reversed custom range is rejected',async()=>{
 const {sb,click}=setup();let saved;
 sb.store.set=(k,v)=>{saved=v};
 sb.document.getElementById=id=>({value:({'bk-period-mode':'month','bk-period-month':'2026-12'})[id]||''});
 await click('period-preset');assert.equal(saved.from,'2026-12-01');assert.equal(saved.to,'2026-12-31');
 saved=null;sb.document.getElementById=id=>({value:({'bk-period-from':'2026-10-10','bk-period-to':'2026-09-01'})[id]||''});
 await click('period-custom');assert.equal(saved,null);
});
