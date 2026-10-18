// T97: posting is part of document issuance, in the same transaction. No backfill or external calls.
const CHART=[['1000','קופה - מזומן','asset'],['1010','בנק - עו"ש','asset'],['1020','לקוחות','asset'],['2010','מע"מ עסקאות','liability'],['4000','הכנסות משירותי כביסה','income']];
async function postOrderDocument(client,{tenant,document:d,actorId}) {
 if(!require('./config').isDemo) return null;
 const tid=tenant.id;
 if(d.tenant_id!==tid)throw {status:409,error:'שיוך מסמך שגוי'};
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bk-document:${tid}`]);
 const {rows:existing}=await client.query('SELECT entry_id FROM bk_order_document_entries WHERE tenant_id=$1 AND document_id=$2',[tid,d.id]);
 if(existing.length)return existing[0].entry_id;
 const {rows:dates}=await client.query("SELECT ($1::timestamptz AT TIME ZONE 'Asia/Jerusalem')::date::text date",[d.issued_at]);
 const date=dates[0].date;
 const {rows:closed}=await client.query('SELECT 1 FROM bk_periods WHERE tenant_id=$1 AND year=$2 AND month=$3',[tid,Number(date.slice(0,4)),Number(date.slice(5,7))]);
 if(closed.length)throw {status:409,error:'התקופה החשבונאית סגורה; לא ניתן להפיק מסמך'};
 let source=d;
 if(d.kind==='credit') {
  const {rows}=await client.query('SELECT * FROM documents WHERE tenant_id=$1 AND id=$2',[tid,d.original_id]);
  if(!rows[0])throw {status:409,error:'מסמך מקור לזיכוי לא נמצא'};
  source=rows[0];
 }
 let cash='1000';
 if(d.order_id){const {rows}=await client.query('SELECT payment_method FROM orders WHERE tenant_id=$1 AND id=$2',[tid,d.order_id]);if(rows[0]?.payment_method==='demo_online')cash='1010';}
 const sign=d.kind==='credit'?-1:1;
 const total=Math.abs(Number(d.total)),net=Math.abs(Number(d.amount)),vat=Math.abs(Number(d.vat));
 if(![total,net,vat].every(Number.isFinite)||Math.abs(net+vat-total)>.005)throw {status:400,error:'סכומי מסמך לא מאוזנים'};
 if(total===0)return null;
 const lines=source.kind==='receipt'?[{code:cash,debit:total,credit:0},{code:'1020',debit:0,credit:total}]:
  [{code:'1020',debit:total,credit:0},{code:'4000',debit:0,credit:net},...(vat?[{code:'2010',debit:0,credit:vat}]:[])];
 for(const [code,name,type] of CHART) await client.query(`INSERT INTO bk_accounts(tenant_id,code,name_he,type,system) VALUES($1,$2,$3,$4,true) ON CONFLICT(tenant_id,code) DO NOTHING`,[tid,code,name,type]);
 const {rows:accounts}=await client.query('SELECT id,code,active FROM bk_accounts WHERE tenant_id=$1 AND code=ANY($2)',[tid,lines.map(l=>l.code)]);
 const byCode=Object.fromEntries(accounts.map(a=>[a.code,a]));
 if(lines.some(l=>!byCode[l.code]?.active))throw {status:409,error:'חשבון נדרש אינו פעיל'};
 const {rows:entries}=await client.query(`INSERT INTO bk_entries(tenant_id,entry_no,entry_date,description,source,created_by)
  SELECT $1,coalesce(max(entry_no),0)+1,$2,$3,'invoice',$4 FROM bk_entries WHERE tenant_id=$1 RETURNING id,entry_no`,
  [tid,date,`מסמך הזמנה (דמו) ${d.title_he||d.kind} ${d.doc_number}/${d.doc_year}`,actorId||null]);
 const eid=entries[0].id;
 for(const l of lines)if(l.debit||l.credit)await client.query(`INSERT INTO bk_lines(tenant_id,entry_id,account_id,debit,credit,details) VALUES($1,$2,$3,$4,$5,$6)`,
  [tid,eid,byCode[l.code].id,sign===1?l.debit:l.credit,sign===1?l.credit:l.debit,`document:${d.id}`]);
 await client.query('INSERT INTO bk_order_document_entries(tenant_id,document_id,entry_id) VALUES($1,$2,$3)',[tid,d.id,eid]);
 await client.query(`INSERT INTO document_events(document_id,action,actor_id,details) VALUES($1,'ledger_posted',$2,$3)`,[d.id,actorId||null,{tenant_id:tid,entry_id:eid,demo:true}]);
 return eid;
}
module.exports={postOrderDocument};
