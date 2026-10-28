#!/usr/bin/env node
// Local development only. Wraps the Lambda handler in an HTTP server and injects the JWT
// claims that API Gateway's Cognito authorizer would normally provide, so the frontend can
// be developed without a deployed stack. Never deployed; never used in production.
try{require('dotenv').config({quiet:true})}catch{}
const http=require('http');
const {handler}=require('../src/handlers/index');
const PORT=process.env.PORT||3000;
const claims=()=>({sub:process.env.DEV_SUB||'dev-user',email:process.env.DEV_EMAIL||'dev@example.test','cognito:groups':(process.env.DEV_GROUPS||'ops').split(','),'custom:account':process.env.DEV_ACCOUNT||'ACCT-001'});
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const chunks=[];for await(const c of req)chunks.push(c);
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end()}
  const event={version:'2.0',routeKey:`${req.method} ${url.pathname}`,rawPath:url.pathname,body:chunks.length?Buffer.concat(chunks).toString('utf8'):undefined,isBase64Encoded:false,queryStringParameters:Object.fromEntries(url.searchParams),requestContext:{http:{method:req.method,path:url.pathname},authorizer:{jwt:{claims:claims()}}}};
  const r=await handler(event);
  res.writeHead(r.statusCode,{...r.headers,'Access-Control-Allow-Origin':'*'});
  res.end(r.body);
}).listen(PORT,()=>console.log(`ParcelPilot API (local): http://localhost:${PORT}`));
