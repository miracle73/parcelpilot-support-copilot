// DynamoDB on-demand single table. Pending actions expire via TTL so an unconfirmed
// proposal can never be executed later, and every executed action writes an immutable
// audit item keyed by account for isolation on read.
const {DDB,PutCommand,GetCommand,DeleteCommand,UpdateCommand,QueryCommand}=require('./aws');
const TABLE=()=>process.env.TABLE_NAME;
const PENDING_TTL_SECONDS=Number(process.env.PENDING_TTL_SECONDS||900);

async function putPending(token,item){
  await DDB().send(new PutCommand({TableName:TABLE(),Item:{pk:`PENDING#${token}`,sk:'PENDING',...item,expiresAt:Math.floor(Date.now()/1000)+PENDING_TTL_SECONDS}}));
}
async function takePending(token){
  if(!token||typeof token!=='string')return null;
  const r=await DDB().send(new GetCommand({TableName:TABLE(),Key:{pk:`PENDING#${token}`,sk:'PENDING'},ConsistentRead:true}));
  if(!r.Item)return null;
  if(r.Item.expiresAt&&r.Item.expiresAt*1000<Date.now()){await DDB().send(new DeleteCommand({TableName:TABLE(),Key:{pk:`PENDING#${token}`,sk:'PENDING'}}));return null}
  // Single-use: the conditional delete is the lock, so a replayed token cannot execute twice.
  try{await DDB().send(new DeleteCommand({TableName:TABLE(),Key:{pk:`PENDING#${token}`,sk:'PENDING'},ConditionExpression:'attribute_exists(pk)'}))}
  catch{return null}
  return r.Item;
}
async function nextActionId(){
  const r=await DDB().send(new UpdateCommand({TableName:TABLE(),Key:{pk:'COUNTER#ACTION',sk:'COUNTER'},UpdateExpression:'ADD #n :one',ExpressionAttributeNames:{'#n':'value'},ExpressionAttributeValues:{':one':1},ReturnValues:'UPDATED_NEW'}));
  return `ACT-${String(r.Attributes.value).padStart(4,'0')}`;
}
async function recordAction(item){
  const id=await nextActionId();
  const record={id,...item,status:'created',executedAt:new Date().toISOString()};
  await DDB().send(new PutCommand({TableName:TABLE(),Item:{pk:`ACCOUNT#${item.account}`,sk:`ACTION#${record.executedAt}#${id}`,entity:'action',...record},ConditionExpression:'attribute_not_exists(pk) OR attribute_not_exists(sk)'}));
  return record;
}
async function listActions(account,limit=25){
  const r=await DDB().send(new QueryCommand({TableName:TABLE(),KeyConditionExpression:'pk = :p AND begins_with(sk,:s)',ExpressionAttributeValues:{':p':`ACCOUNT#${account}`,':s':'ACTION#'},ScanIndexForward:false,Limit:limit}));
  return (r.Items||[]).map(({pk,sk,entity,...rest})=>rest);
}
module.exports={putPending,takePending,recordAction,listActions,nextActionId,PENDING_TTL_SECONDS};
