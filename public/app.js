const $=s=>document.querySelector(s),chat=$('#chat'),input=$('#input'),sendButton=$('#send');
let token,busy=false;
const esc=s=>{let d=document.createElement('div');d.textContent=s;return d.innerHTML};

function add(text,who='bot',x={}){
  const e=document.createElement('div');e.className='message '+who;
  let h=who==='bot'?'<div class="avatar bot-avatar">PP</div>':'';
  h+=`<div class="bubble">${text}`;
  if(x.tools?.length)h+=`<details open><summary>Tool activity (${x.tools.length})</summary>${x.tools.map(t=>`<div class="tool">✓ <b>${esc(t.name)}</b> — ${esc(t.label)}</div>`).join('')}</details>`;
  if(x.sources?.length)h+=`<div class="sources"><b>Evidence</b>${x.sources.map(s=>`<span>${esc(s.title)}${typeof s.authority==='number'?` · authority ${s.authority}/100`:''}</span>`).join('')}</div>`;
  if(x.confidence)h+=`<div class="confidence ${x.confidence}">${x.confidence} confidence</div>`;
  if(x.action)h+=`<button class="action">Prepare ${x.action.type.replace('_',' ')}</button>`;
  e.innerHTML=h+'</div>';chat.append(e);chat.scrollTop=chat.scrollHeight;
  if(x.action)e.querySelector('.action').onclick=()=>prepare(x.action);
  return e;
}

function showLoading(){
  const e=document.createElement('div');e.className='message bot loading-message';
  e.innerHTML='<div class="avatar bot-avatar">PP</div><div class="bubble loading-bubble"><span class="spinner"></span><div><b>ParcelPilot is investigating</b><small>Checking authorised data and source guidance…</small></div></div>';
  chat.append(e);chat.scrollTop=chat.scrollHeight;return e;
}

function setBusy(value){busy=value;input.disabled=value;sendButton.disabled=value;sendButton.textContent=value?'Working…':'Send ↑'}

async function send(text=input.value.trim()){
  if(!text||busy)return;
  add(esc(text),'user');input.value='';setBusy(true);const loading=showLoading();
  try{
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,role:role.value,account:account.value})});
    const d=await r.json();loading.remove();add(`<p>${esc(d.answer||d.error||'No response was returned.')}</p>`,'bot',d);
  }catch{
    loading.remove();add('<p>I could not reach the support agent. Please try again.</p>','bot',{confidence:'low'});
  }finally{setBusy(false);input.focus()}
}

async function prepare(a){const r=await fetch('/api/actions/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...a,role:role.value,account:account.value})}),d=await r.json();if(!r.ok)return add(`<p>${esc(d.error)}</p>`);token=d.token;add(`<b>Review before action</b><p>${esc(d.preview.summary)}</p><small>No state has changed.</small><p><button id="confirmAction" class="confirm">Confirm and execute</button></p>`);$('#confirmAction').onclick=confirm}
async function confirm(){const r=await fetch('/api/actions/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,confirm:true})}),d=await r.json();add(r.ok?`<b>Action ${esc(d.id)} created</b><p>An audit record was saved.</p>`:`<p>${esc(d.error)}</p>`)}
async function radar(){if(role.value==='customer'){alerts.innerHTML='<div class="empty">Issue Radar requires an authorised support or operations role.</div>';metrics.innerHTML='';return}const r=await fetch('/api/issues',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:role.value,account:account.value})}),d=await r.json();metrics.innerHTML=Object.entries(d.summary).map(([k,v])=>`<div><strong>${v}</strong><span>${k.replace(/([A-Z])/g,' $1')}</span></div>`).join('');alerts.innerHTML=d.alerts.map(a=>`<article class="${a.level}"><b>${esc(a.title)}</b><p>${esc(a.detail)}</p><span>${a.level}</span></article>`).join('')}

sendButton.onclick=()=>send();input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};
document.querySelectorAll('.chips button').forEach(b=>b.onclick=()=>send(b.querySelector('small')?.textContent||b.textContent));
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.view').forEach(x=>x.classList.add('hidden'));$('#'+b.dataset.view).classList.remove('hidden');$('#title').textContent=b.dataset.view==='radar'?'Issue radar':'Hello, Support Team';if(b.dataset.view==='radar')radar()});
$('#refresh').onclick=radar;
