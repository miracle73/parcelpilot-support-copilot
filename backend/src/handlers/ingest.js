// Ingestion Lambda: reads the raw sources from S3, rebuilds the dataset snapshot, and
// writes it back. Invoked manually (or on a schedule) rather than on the request path.
const {buildDataset}=require('../ingest');
const {listDatasetSource,getDatasetObject,putDatasetObject,S3}=require('../aws');
const {GetObjectCommand}=require('@aws-sdk/client-s3');

const buffer=async key=>{
  const r=await S3().send(new GetObjectCommand({Bucket:process.env.DATASET_BUCKET,Key:key}));
  const chunks=[];for await(const c of r.Body)chunks.push(c);return Buffer.concat(chunks);
};

exports.handler=async()=>{
  const prefix=process.env.SOURCE_PREFIX||'source/';
  const keys=(await listDatasetSource(prefix)).filter(k=>k!==prefix);
  if(!keys.length)throw new Error(`No source objects under s3://${process.env.DATASET_BUCKET}/${prefix}`);
  const sources=await Promise.all(keys.map(async key=>({filename:key.slice(prefix.length),buffer:await buffer(key)})));
  const dataset=await buildDataset(sources);
  await putDatasetObject(process.env.DATASET_KEY||'ingested.json',JSON.stringify(dataset));
  const summary={documents:dataset.documents.length,accounts:dataset.accounts.length,orders:dataset.orders.length,tickets:dataset.tickets.length,snapshot:dataset.snapshot};
  console.log('Ingestion complete',summary);
  return summary;
};
