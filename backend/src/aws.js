// Thin AWS adapter. Clients are created lazily and reused across invocations so warm
// containers pay no connection cost, and every lookup is cached for the container lifetime.
const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {SSMClient,GetParameterCommand}=require('@aws-sdk/client-ssm');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,PutCommand,GetCommand,DeleteCommand,UpdateCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
let s3,ssm,ddb;
const S3=()=>s3||=new S3Client({});
const SSM=()=>ssm||=new SSMClient({});
const DDB=()=>ddb||=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
const stream=async b=>{const c=[];for await(const x of b)c.push(x);return Buffer.concat(c)};

async function getDatasetObject(key){
  const r=await S3().send(new GetObjectCommand({Bucket:process.env.DATASET_BUCKET,Key:key}));
  return (await stream(r.Body)).toString('utf8');
}
async function putDatasetObject(key,body,contentType='application/json'){
  await S3().send(new PutObjectCommand({Bucket:process.env.DATASET_BUCKET,Key:key,Body:body,ContentType:contentType,ServerSideEncryption:'AES256'}));
}
async function listDatasetSource(prefix){
  const {ListObjectsV2Command}=require('@aws-sdk/client-s3');
  const r=await S3().send(new ListObjectsV2Command({Bucket:process.env.DATASET_BUCKET,Prefix:prefix}));
  return (r.Contents||[]).map(x=>x.Key);
}

const secrets=new Map();
// SecureString parameters are decrypted server-side and never leave the Lambda runtime.
async function getSecret(name){
  if(!name)return undefined;
  if(secrets.has(name))return secrets.get(name);
  try{
    const r=await SSM().send(new GetParameterCommand({Name:name,WithDecryption:true}));
    secrets.set(name,r.Parameter.Value);return r.Parameter.Value;
  }catch(e){console.error('SSM parameter unavailable',name,e.name);secrets.set(name,undefined);return undefined}
}
module.exports={S3,SSM,DDB,PutCommand,GetCommand,DeleteCommand,UpdateCommand,QueryCommand,getDatasetObject,putDatasetObject,listDatasetSource,getSecret};
