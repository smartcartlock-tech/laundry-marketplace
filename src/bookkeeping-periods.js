// T101: checks and close/reopen are tenant-scoped. Shared posting lock used inside transactions.
function periodInput(year,month){return Number.isInteger(year)&&year>=2000&&year<=2100&&Number.isInteger(month)&&month>=1&&month<=12;}
async function lockPosting(client,tid){await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bk-document:${tid}`]);}
async function periodSummary(query,tid,year,month){
 const from=`${year}-${String(month).padStart(2,'0')}-01`;
 const {rows:[totals]}=await query(`SELECT count(DISTINCT e.id)::int entries,coalesce(sum(l.debit),0)::numeric(12,2) debit,coalesce(sum(l.credit),0)::numeric(12,2) credit,
 coalesce(sum(CASE WHEN a.type='income' THEN l.credit-l.debit ELSE 0 END),0)::numeric(12,2) income,
 coalesce(sum(CASE WHEN a.type='expense' THEN l.debit-l.credit ELSE 0 END),0)::numeric(12,2) expenses
 FROM bk_entries e LEFT JOIN bk_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id LEFT JOIN bk_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id
 WHERE e.tenant_id=$1 AND e.entry_date >= $2::date AND e.entry_date < $2::date+interval '1 month'`,[tid,from]);
 const {rows:unbalanced}=await query(`SELECT e.entry_no FROM bk_entries e LEFT JOIN bk_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
 WHERE e.tenant_id=$1 AND e.entry_date >= $2::date AND e.entry_date < $2::date+interval '1 month' GROUP BY e.id HAVING count(l.id)=0 OR sum(l.debit)<>sum(l.credit)`,[tid,from]);
 // Check each entire issued series, not just this month's slice; otherwise earlier gaps disappear.
 const {rows:series}=await query(`SELECT 'bookkeeping' surface,kind,doc_year,count(*)::int n,min(doc_number)::int first,max(doc_number)::int last
 FROM bk_documents WHERE tenant_id=$1 AND status='issued' GROUP BY kind,doc_year
 UNION ALL SELECT 'orders',kind,0,count(*)::int,min(doc_number)::int,max(doc_number)::int FROM documents WHERE tenant_id=$1 GROUP BY kind`,[tid]);
 const gaps=series.filter(s=>s.first!==1||s.n!==s.last);
 const {rows:closed}=await query('SELECT closed_at FROM bk_periods WHERE tenant_id=$1 AND year=$2 AND month=$3',[tid,year,month]);
 return {year,month,totals,balanced:unbalanced.length===0,unbalanced_entries:unbalanced.map(e=>e.entry_no),sequence_ok:gaps.length===0,series,gaps,closed:!!closed.length,closed_at:closed[0]?.closed_at||null,demo:true,note:'דוח בקרה פנימי; אינו אישור רשות המסים או בדיקת רואה חשבון'};
}
module.exports={periodInput,lockPosting,periodSummary};
