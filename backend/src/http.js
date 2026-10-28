// API Gateway HTTP API payload v2 helpers. CORS is answered by the API itself
// (CorsConfiguration), so handlers only emit the body and security headers.
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Strict-Transport-Security':'max-age=31536000; includeSubDomains','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'},body:JSON.stringify(body)});
function parseBody(event){
  if(!event.body)return {};
  const raw=event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body;
  try{const v=JSON.parse(raw||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}catch{throw new Error('Request body must be JSON')}
}
module.exports={json,parseBody};
