// One Lambda serves every API Gateway route. A single warm container means one cold start
// for the whole API and one IAM role to keep least-privilege, which is the cheapest shape
// for this traffic profile; routes are still declared individually in template.yaml.
const crypto=require('crypto');
const {json,parseBody}=require('../http');
const {identity,scope}=require('../auth');
const {DATA,initData,analyseIssues}=require('../data');
const {runAgent}=require('../agent');
const {putPending,takePending,recordAction,listActions}=require('../store');

const ACTION_TYPES=['escalation','ticket_update','follow_up'];

async function context(){
  return json(200,{snapshot:DATA.snapshot,accounts:Object.entries(DATA.accounts).map(([id,a])=>({id,name:a.account_name}))});
}

async function chat(event,user){
  const body=parseBody(event);
  const message=String(body.message||'').slice(0,4000);
  if(!message.trim())return json(400,{error:'A message is required'});
  const {ensureProvider,runOpenAIAgent}=require('../openai-agent');
  let ready=false;
  try{ready=await ensureProvider()}catch(e){console.error('Agent provider init failed:',e.message)}
  if(ready){
    try{return json(200,await runOpenAIAgent(message,user))}
    catch(e){console.error('Agent provider error:',e.message);return json(200,{...runAgent(message,user),framework:'Deterministic safety fallback',agentError:'Model provider unavailable'})}
  }
  return json(200,{...runAgent(message,user),framework:'Deterministic fallback (configure the OpenRouter parameter to enable the SDK agent)'});
}

async function issues(event,user){
  if(user.role==='customer')return json(403,{error:'Operations access required'});
  return json(200,analyseIssues());
}

async function prepare(event,user){
  const body=parseBody(event);
  if(!ACTION_TYPES.includes(body.type)||(user.role==='customer'&&body.type!=='escalation'))return json(403,{error:'Not authorised'});
  const token=crypto.randomUUID();
  const item={type:body.type,summary:String(body.summary||'').slice(0,500),target:String(body.target||'').slice(0,50),role:user.role,account:user.account,actorSub:user.sub,preparedAt:new Date().toISOString()};
  await putPending(token,item);
  return json(200,{token,requiresConfirmation:true,preview:item});
}

async function confirm(event,user){
  const body=parseBody(event);
  const item=await takePending(body.token);
  if(!item)return json(404,{error:'Action expired'});
  // The confirmer must be the same identity that prepared the action, in the same scope.
  if(item.actorSub&&item.actorSub!==user.sub)return json(403,{error:'Not authorised'});
  if(body.confirm!==true){await putPending(body.token,item);return json(400,{error:'Explicit confirmation required'})}
  const {pk,sk,expiresAt,...payload}=item;
  const record=await recordAction(payload);
  return json(201,record);
}

async function audit(event,user){
  if(user.role==='customer'&&event.queryStringParameters?.account&&event.queryStringParameters.account!==user.account)return json(403,{error:'Not authorised'});
  return json(200,{account:user.account,actions:await listActions(user.account)});
}

const ROUTES={
  'GET /api/context':context,
  'POST /api/chat':chat,
  'POST /api/issues':issues,
  'POST /api/actions/prepare':prepare,
  'POST /api/actions/confirm':confirm,
  'GET /api/actions':audit
};

exports.handler=async event=>{
  try{
    const who=identity(event);
    if(!who)return json(401,{error:'Authentication required'});
    await initData();
    const route=ROUTES[event.routeKey]||ROUTES[`${event.requestContext?.http?.method} ${event.rawPath}`];
    if(!route)return json(404,{error:'Not found'});
    const body=event.body?safeParse(event):{};
    const user=scope(who,{role:body.role,account:body.account||event.queryStringParameters?.account},DATA.accounts);
    return await route(event,user);
  }catch(e){
    console.error('Request failed:',e);
    return json(e.message==='Request body must be JSON'?400:500,{error:e.message==='Request body must be JSON'?e.message:'Internal error'});
  }
};
function safeParse(event){try{return parseBody(event)}catch{return {}}}
