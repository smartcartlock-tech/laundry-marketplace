// T99: signed demo documents alongside operational billing reports. Never replace an original.
const {issueDocument,issueConsolidatedInvoice,VAT_RATE}=require('./documents');
const {buildDocumentPDF,collectPdf,docVerificationImages}=require('./receipt');
const crypto=require('crypto');
async function subscriptionCharge(client,sub) {
 if(!require('./config').isDemo)return null;
 const tid=sub.tenant_id;
 const {rows:locked}=await client.query('SELECT *,period_start::text AS period_date FROM subscriptions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tid,sub.id]);
 if(!locked[0])throw {status:404,error:'מנוי לא נמצא'};
 sub={...locked[0],period_start:locked[0].period_date};
 const {rows:old}=await client.query('SELECT * FROM subscription_document_charges WHERE tenant_id=$1 AND subscription_id=$2 AND period_start=$3',[tid,sub.id,sub.period_start]);
 if(old.length)return old[0];
 const {rows:ts}=await client.query('SELECT * FROM tenants WHERE id=$1',[tid]);const tenant=ts[0];
 if(!tenant?.dealer_type)return null;
 const {rows:ps}=await client.query('SELECT * FROM subscription_plans WHERE tenant_id=$1 AND id=$2',[tid,sub.plan_id]);const plan=ps[0];
 const {rows:us}=await client.query('SELECT id,name,phone FROM users WHERE id=$1',[sub.user_id]);const customer=us[0];
 if(!plan||!customer)throw {status:409,error:'מנוי אינו מקושר לתוכנית או ללקוח'};
 const total=Number(plan.price),net=tenant.dealer_type==='morasha'?Math.round(total/(1+VAT_RATE)*100)/100:total;
 const items=[{name:`מנוי ${plan.name} (${new Date(sub.period_start).toISOString().slice(0,10)})`,qty:1,price:total}];
 const docs=[];
 for(const kind of ['invoice','receipt']){
  const d=await issueDocument(client,{tenant,kind,customer,amount:kind==='receipt'?total:net,vat:kind==='receipt'?0:Math.round((total-net)*100)/100,total});
  const codes=await docVerificationImages(d);const pdf=await collectPdf(buildDocumentPDF({doc:d,items,tenant,customer,copy:false,codes,note:'חיוב מחזור מנוי (דמו)'}));
  await client.query('UPDATE documents SET pdf=$3,sha256=$4 WHERE tenant_id=$1 AND id=$2 AND pdf IS NULL',[tid,d.id,pdf,crypto.createHash('sha256').update(pdf).digest('hex')]);docs.push(d);
 }
 const {rows}=await client.query(`INSERT INTO subscription_document_charges(tenant_id,subscription_id,period_start,invoice_id,receipt_id) VALUES($1,$2,$3,$4,$5) RETURNING *`,[tid,sub.id,sub.period_start,docs[0].id,docs[1].id]);
 return rows[0];
}
async function consolidatedFiscal(client,{tenantId,accountId,year,month}) {
 if(!require('./config').isDemo)return null;
 const {rows:accounts}=await client.query('SELECT * FROM business_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,accountId]);
 const account=accounts[0];if(!account)throw {status:404,error:'חשבון עסקי לא נמצא'};
 const {rows:old}=await client.query('SELECT document_id FROM business_fiscal_documents WHERE tenant_id=$1 AND account_id=$2 AND year=$3 AND month=$4',[tenantId,accountId,year,month]);
 if(old.length)return old[0];
 const {rows:ts}=await client.query('SELECT * FROM tenants WHERE id=$1',[tenantId]);const tenant=ts[0];if(!tenant.dealer_type)return null;
 const {rows:orders}=await client.query(`SELECT * FROM orders o WHERE tenant_id=$1 AND business_account_id=$2 AND status='delivered'
  AND extract(year from created_at AT TIME ZONE 'Asia/Jerusalem')=$3 AND extract(month from created_at AT TIME ZONE 'Asia/Jerusalem')=$4
  AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.tenant_id=$1 AND d.order_id=o.id AND d.kind IN ('invoice','consolidated'))
  AND NOT EXISTS(SELECT 1 FROM document_orders x JOIN documents d ON d.id=x.document_id WHERE d.tenant_id=$1 AND x.order_id=o.id)
  ORDER BY id FOR UPDATE`,[tenantId,accountId,year,month]);
 if(!orders.length)return null;
 // Business account is the recipient; there may be several linked order users.
 const customer={id:null,name:account.name,phone:account.contact_phone};
 const d=await issueConsolidatedInvoice(client,{tenant,customer,orders});
 await client.query('INSERT INTO business_fiscal_documents(tenant_id,account_id,year,month,document_id) VALUES($1,$2,$3,$4,$5)',[tenantId,accountId,year,month,d.id]);
 return {document_id:d.id};
}
module.exports={subscriptionCharge,consolidatedFiscal};
