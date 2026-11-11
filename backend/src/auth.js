// Identity is derived only from the Cognito-verified JWT claims that the API Gateway JWT
// authorizer puts on the event. Request bodies and headers can never raise privilege:
// the signed-in group is the ceiling and callers may only narrow their own scope.
const ROLES=['customer','support','ops'];
const RANK={customer:0,support:1,ops:2};

function claimsFrom(event){
  const c=event?.requestContext?.authorizer?.jwt?.claims;
  if(!c)return null;
  let groups=c['cognito:groups'];
  if(typeof groups==='string')groups=groups.replace(/^\[|\]$/g,'').split(/[,\s]+/).filter(Boolean);
  return {sub:c.sub,email:c.email,groups:Array.isArray(groups)?groups:[],account:c['custom:account']||null};
}

function identity(event){
  const c=claimsFrom(event);
  if(!c||!c.sub)return null;
  const granted=c.groups.filter(g=>ROLES.includes(g));
  const role=granted.sort((a,b)=>RANK[b]-RANK[a])[0]||'customer';
  return {sub:c.sub,email:c.email,role,account:c.account||'ACCT-001'};
}

// Staff may inspect another account or step *down* to a lower role to reproduce what a
// customer sees. Customers are pinned to their own account and role.
function scope(identityRecord,requested={},knownAccounts={}){
  const base=identityRecord;
  let role=base.role,account=base.account;
  const wanted=requested.role;
  if(ROLES.includes(wanted)&&RANK[wanted]<=RANK[base.role])role=wanted;
  const wantedAccount=requested.account;
  if(wantedAccount&&knownAccounts[wantedAccount]&&RANK[base.role]>=RANK.support)account=wantedAccount;
  if(!knownAccounts[account])account=Object.keys(knownAccounts)[0]||account;
  return {role,account,sub:base.sub,email:base.email,grantedRole:base.role,homeAccount:base.account};
}
module.exports={identity,scope,claimsFrom,ROLES,RANK};
