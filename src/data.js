const raw=require('../data/ingested.json');
const bool=x=>String(x).toLowerCase()==='true',num=x=>Number(x),date=x=>new Date(String(x).replace(' ','T')+'+05:30');
const accounts=Object.fromEntries(raw.accounts.map(x=>[x.account_id,x]));
const orders=raw.orders.map(x=>({...x,shipment_fee_inr:num(x.shipment_fee_inr),carrier_fault:bool(x.carrier_fault),customer_fault:bool(x.customer_fault)}));
const DATA={...raw,accounts,orders,snapshotDate:date('2026-08-16 11:00')};
const words=s=>String(s).toLowerCase().split(/\W+/).filter(x=>x.length>2);
function allowed(d,u){return !d.account_id||u.role!=='customer'||d.account_id===u.account}
function searchDocuments(q,u){let w=words(q);return DATA.documents.filter(d=>allowed(d,u)).map(d=>({...d,score:w.filter(x=>(d.title+' '+d.text).toLowerCase().includes(x)).length+d.authority/1000})).sort((a,b)=>b.score-a.score).slice(0,5)}
function lookupOrder(id,u){let x=orders.find(o=>o.order_id===id);return x&&(u.role!=='customer'||x.account_id===u.account)?x:null}
function lookupTicket(id,u){let x=raw.tickets.find(t=>t.ticket_id===id);return x&&(u.role!=='customer'||x.account_id===u.account)?x:null}
function agreement(account){return DATA.documents.find(d=>d.kind==='agreement'&&d.account_id===account)}
function severity(t){let s=(t.subject+' '+t.description).toLowerCase();return /all shipment|security|credential|api key exposure/.test(s)?'P1':/fails|failure|unavailable|degraded/.test(s)?'P2':'P3'}
function slaHours(t){let p=accounts[t.account_id].plan,sev=severity(t),ag=agreement(t.account_id)?.text||'';if(t.account_id==='ACCT-001')return{P1:.25,P2:1,P3:8}[sev];if(t.account_id==='ACCT-002')return{P1:2,P2:4,P3:16}[sev];return{Enterprise:{P1:.5,P2:2,P3:8},Growth:{P1:2,P2:4,P3:16},Standard:{P1:4,P2:8,P3:16}}[p][sev]}
function analyseIssues(){let open=raw.tickets.filter(t=>t.status==='open'),age=t=>(DATA.snapshotDate-date(t.created_at))/36e5,items=open.map(t=>({...t,severity:severity(t),age:age(t),target:slaHours(t)})),breaches=items.filter(t=>t.age>=t.target),known=items.filter(t=>/bulk upload/i.test(t.subject)),security=items.filter(t=>t.severity==='P1');return{snapshot:raw.snapshot,summary:{open:open.length,slaBreaches:breaches.length,p1Incidents:security.length,knownIssueMatches:known.length},alerts:[...security.map(t=>({level:'critical',title:`${t.ticket_id}: ${t.severity} immediate escalation`,detail:t.subject})),...breaches.map(t=>({level:'critical',title:`${t.ticket_id} exceeded ${t.target}h target`,detail:`${accounts[t.account_id].account_name} · ${t.age.toFixed(1)}h old`})),...known.map(t=>({level:'high',title:`${t.ticket_id} matches KI-208`,detail:'Large CSV bulk-upload failure; workaround is files below 3,000 rows.'}))]}}
module.exports={DATA,date,searchDocuments,lookupOrder,lookupTicket,agreement,analyseIssues};
