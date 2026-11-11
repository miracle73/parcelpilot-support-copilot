// Cognito hosted login using OAuth 2.0 authorization code + PKCE. This is a public client:
// there is no client secret in the bundle, and no API key of any kind reaches the browser.
// The ID token is kept in sessionStorage only, so it dies with the tab.
const CFG=window.PARCELPILOT_CONFIG||{};
const KEY='pp.session';
const b64url=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sha256=async s=>b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const redirectUri=()=>CFG.redirectUri||location.origin+location.pathname;

function readSession(){
  try{
    const s=JSON.parse(sessionStorage.getItem(KEY)||'null');
    if(!s||s.expiresAt<=Date.now()+5000)return null;
    return s;
  }catch{return null}
}
function claimsOf(idToken){
  try{return JSON.parse(atob(idToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))}catch{return {}}
}

async function login(){
  const verifier=random(),state=random();
  sessionStorage.setItem('pp.pkce',JSON.stringify({verifier,state}));
  const q=new URLSearchParams({response_type:'code',client_id:CFG.clientId,redirect_uri:redirectUri(),scope:'openid email profile',state,code_challenge:await sha256(verifier),code_challenge_method:'S256'});
  location.assign(`${CFG.cognitoDomain}/oauth2/authorize?${q}`);
}
function logout(){
  sessionStorage.removeItem(KEY);
  location.assign(`${CFG.cognitoDomain}/logout?client_id=${CFG.clientId}&logout_uri=${encodeURIComponent(redirectUri())}`);
}

async function exchange(code){
  const saved=JSON.parse(sessionStorage.getItem('pp.pkce')||'{}');
  sessionStorage.removeItem('pp.pkce');
  const r=await fetch(`${CFG.cognitoDomain}/oauth2/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:CFG.clientId,code,redirect_uri:redirectUri(),code_verifier:saved.verifier||''})});
  if(!r.ok)throw new Error('Sign-in could not be completed');
  const t=await r.json();
  const session={idToken:t.id_token,expiresAt:Date.now()+(t.expires_in-30)*1000,claims:claimsOf(t.id_token)};
  sessionStorage.setItem(KEY,JSON.stringify(session));
  return session;
}

// Resolves the signed-in session, completing a redirect callback if one is in the URL.
async function init(){
  const params=new URLSearchParams(location.search);
  const code=params.get('code');
  if(code){
    const saved=JSON.parse(sessionStorage.getItem('pp.pkce')||'{}');
    if(params.get('state')!==saved.state){sessionStorage.removeItem('pp.pkce');throw new Error('Sign-in state mismatch')}
    const session=await exchange(code);
    history.replaceState({},'',location.pathname);
    return session;
  }
  return readSession();
}

function profile(){
  const s=readSession();if(!s)return null;
  let groups=s.claims['cognito:groups']||[];
  if(typeof groups==='string')groups=[groups];
  const rank={customer:0,support:1,ops:2};
  const role=groups.filter(g=>g in rank).sort((a,b)=>rank[b]-rank[a])[0]||'customer';
  return {email:s.claims.email,role,account:s.claims['custom:account']||null,groups};
}

// Every API call carries the Cognito ID token; API Gateway rejects the request before
// Lambda runs if it is missing, expired or not issued by this user pool.
async function api(path,{method='GET',body}={}){
  const s=readSession();
  if(!s){await login();throw new Error('Redirecting to sign-in')}
  const r=await fetch(CFG.apiBaseUrl+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.idToken}`},body:body?JSON.stringify(body):undefined});
  if(r.status===401){sessionStorage.removeItem(KEY);await login();throw new Error('Session expired')}
  return r;
}
window.PP_AUTH={init,login,logout,profile,api,configured:Boolean(CFG.clientId&&CFG.cognitoDomain&&CFG.apiBaseUrl)};
