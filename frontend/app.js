const $=s=>document.querySelector(s),chat=$('#chat'),input=$('#input'),sendButton=$('#send');
let busy=false,me=null;
const esc=s=>{let d=document.createElement('div');d.textContent=s;return d.innerHTML};
// Named callApi, not api: auth.js already declares a top-level `api`, and two top-level
// declarations of the same name across classic scripts is a SyntaxError that kills the
// whole bundle — which left the signed-out shell on screen instead of the sign-in gate.
const callApi=(path,opts)=>window.PP_AUTH.api(path,opts);
// The signed-in Cognito group is the ceiling. These selectors can only narrow scope; the
// Lambda re-derives the effective role and account from the token on every request.
const requestScope=()=>({role:role.value,account:account.value});
// The API returns camelCase keys; these are what a person would actually call them.
const METRIC_LABELS={open:'still open',slaBreaches:'past their SLA',p1Incidents:'P1 incidents',knownIssueMatches:'known issues'};

function add(text,who='bot',x={}){
  const e=document.createElement('div');e.className='message '+who;
  let h=who==='bot'?'<div class="avatar bot-avatar">PP</div>':'';
  h+=`<div class="bubble">${text}`;
  if(x.tools?.length)h+=`<details open><summary>How I got there (${x.tools.length})</summary>${x.tools.map(t=>`<div class="tool">✓ <b>${esc(t.name)}</b> — ${esc(t.label)}</div>`).join('')}</details>`;
  if(x.sources?.length)h+=`<div class="sources"><b>What I read</b>${x.sources.map(s=>`<span>${esc(s.title)}${typeof s.authority==='number'?` · authority ${s.authority}/100`:''}</span>`).join('')}</div>`;
  if(x.confidence)h+=`<div class="confidence ${x.confidence}">${x.confidence} confidence</div>`;
  if(x.action){const labels={escalation:'Escalate this',ticket_update:'Update the ticket',follow_up:'Set a follow-up'};h+=`<button class="action">${labels[x.action.type]||'Look at this first'}</button>`}
  e.innerHTML=h+'</div>';chat.append(e);chat.scrollTop=chat.scrollHeight;
  if(x.action)e.querySelector('.action').onclick=()=>prepare(x.action);
  return e;
}

function showLoading(){
  const e=document.createElement('div');e.className='message bot loading-message';
  e.innerHTML='<div class="avatar bot-avatar">PP</div><div class="bubble loading-bubble"><span class="spinner"></span><div><b>Reading the file</b><small>Checking the contract, the SOP, and what you are allowed to see…</small></div></div>';
  chat.append(e);chat.scrollTop=chat.scrollHeight;return e;
}

function setBusy(value){busy=value;input.disabled=value;sendButton.disabled=value;sendButton.textContent=value?'Working…':'Send ↑'}

async function send(text=input.value.trim()){
  if(!text||busy)return;
  add(esc(text),'user');input.value='';setBusy(true);const loading=showLoading();
  try{
    const r=await callApi('/api/chat',{method:'POST',body:{message:text,...requestScope()}});
    const d=await r.json();loading.remove();add(`<p>${esc(d.answer||d.error||'Nothing came back that time.')}</p>`,'bot',d);
  }catch(e){
    loading.remove();
    const expired=e.message==='Session expired'||e.message==='Redirecting to sign-in';
    add(`<p>${esc(expired?'Session timed out — sending you back to sign in.':'Could not reach the desk. Try that again?')}</p>`,'bot',{confidence:'low'});
  }finally{setBusy(false);input.focus()}
}

async function prepare(a){
  try{
    const r=await callApi('/api/actions/prepare',{method:'POST',body:{...a,...requestScope()}}),d=await r.json();
    if(!r.ok)return add(`<p>${esc(d.error)}</p>`);
    const card=add(`<b>Check this before it happens</b><p>${esc(d.preview.summary)}</p><small>Nothing has changed yet.</small><p><button class="confirm">Yes, do it</button></p>`);
    card.querySelector('.confirm').onclick=e=>confirm(d.token,e.currentTarget);
  }catch(e){add(`<p>${esc(e.message)}</p>`)}
}

async function confirm(actionToken,button){
  button.disabled=true;button.textContent='Working…';
  try{
    const r=await callApi('/api/actions/confirm',{method:'POST',body:{token:actionToken,confirm:true}}),d=await r.json();
    if(!r.ok){button.disabled=false;button.textContent='Try again';return add(`<p>${esc(d.error)}</p>`)}
    button.textContent='Executed';
    add(`<b>Done — ${esc(d.id)}</b><p>It is in the audit trail.</p>`);
  }catch(e){button.disabled=false;button.textContent='Try again';add(`<p>${esc(e.message)}</p>`)}
}

async function radar(){
  if(role.value==='customer'){alerts.innerHTML='<div class="empty">Issue Radar is for support and ops. This account does not have it.</div>';metrics.innerHTML='';return}
  try{
    const r=await callApi('/api/issues',{method:'POST',body:requestScope()}),d=await r.json();
    if(!r.ok){alerts.innerHTML=`<div class="empty">${esc(d.error||'Issue Radar is not answering right now.')}</div>`;metrics.innerHTML='';return}
    metrics.innerHTML=Object.entries(d.summary).map(([k,v])=>`<div><strong>${v}</strong><span>${METRIC_LABELS[k]||k.replace(/([A-Z])/g,' $1')}</span></div>`).join('');
    alerts.innerHTML=d.alerts.map(a=>`<article class="${a.level}"><b>${esc(a.title)}</b><p>${esc(a.detail)}</p><span>${a.level}</span></article>`).join('');
  }catch(e){alerts.innerHTML=`<div class="empty">${esc(e.message)}</div>`}
}

// Only the roles the signed-in identity actually holds are selectable, and a customer is
// pinned to their own account, so the UI cannot even offer an escalation of privilege.
function applyIdentity(){
  const rank={customer:0,support:1,ops:2};
  [...role.options].forEach(o=>{o.disabled=rank[o.value]>rank[me.role]});
  role.value=me.role;
  if(me.role==='customer'){
    [...account.options].forEach(o=>{o.disabled=o.value!==me.account});
    if(me.account)account.value=me.account;
    account.disabled=true;
  }else if(me.account)account.value=me.account;
  $('#whoami').textContent=`${me.email} · ${me.role}`;
  $('#signout').hidden=false;
}

async function loadAccounts(){
  try{
    const r=await callApi('/api/context');
    if(!r.ok)return;
    const d=await r.json();
    if(d.accounts?.length)account.innerHTML=d.accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
    if(me.role==='customer'){
      [...account.options].forEach(o=>{o.disabled=o.value!==me.account});
      account.disabled=true;
    }
    if(me.account&&[...account.options].some(o=>o.value===me.account))account.value=me.account;
    if(d.snapshot)$('#snapshot').textContent=`Working from the ${d.snapshot} snapshot`;
  }catch{}
}

function gate(message){
  $('#gate').hidden=false;
  $('#gate-message').textContent=message;
  document.querySelectorAll('main .view, main footer').forEach(x=>x.classList.add('hidden'));
}

(async()=>{
  sendButton.onclick=()=>send();
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};
  document.querySelectorAll('.chips button').forEach(b=>b.onclick=()=>{
    if(b.dataset.account&&!account.disabled)account.value=b.dataset.account;
    const wanted=b.dataset.role&&role.querySelector('option[value="'+b.dataset.role+'"]');
    if(wanted&&!wanted.disabled)role.value=b.dataset.role;
    send(b.querySelector('small')?.textContent||b.textContent);
  });
  document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.view').forEach(x=>x.classList.add('hidden'));
    $('#'+b.dataset.view).classList.remove('hidden');
    $('#title').textContent=b.dataset.view==='radar'?'Issue radar':'Hello, Support Team';
    if(b.dataset.view==='radar')radar();
  });
  $('#refresh').onclick=radar;
  $('#signin').onclick=()=>window.PP_AUTH.login();
  $('#signout').onclick=()=>window.PP_AUTH.logout();

  if(!window.PP_AUTH.configured)return gate('This build is missing its API and sign-in settings. Set API_BASE_URL, COGNITO_DOMAIN and COGNITO_CLIENT_ID in Vercel, then redeploy.');
  try{await window.PP_AUTH.init()}catch(e){return gate(e.message)}
  me=window.PP_AUTH.profile();
  if(!me)return gate('Use your ParcelPilot account — it takes a second.');
  $('#gate').hidden=true;
  applyIdentity();
  await loadAccounts();
})();
