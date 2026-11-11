#!/usr/bin/env node
// Local ingestion: rebuilds backend/data-source/ingested.json from the committed sources
// so the deterministic engine and unit tests run offline. Pass --upload to also push the
// sources and snapshot to the deployed S3 dataset bucket.
const fs=require('fs'),path=require('path');
const {buildDataset}=require('../src/ingest');
const root=path.join(__dirname,'..','data-source'),out=path.join(root,'ingested.json');
(async()=>{
  const files=fs.readdirSync(root).filter(x=>/\.(pdf|xlsx)$/.test(x));
  const sources=files.map(filename=>({filename,buffer:fs.readFileSync(path.join(root,filename))}));
  const dataset=await buildDataset(sources);
  fs.writeFileSync(out,JSON.stringify(dataset,null,2));
  console.log(`Ingested ${dataset.documents.length} documents, ${dataset.accounts.length} accounts, ${dataset.orders.length} orders, and ${dataset.tickets.length} tickets`);
  if(process.argv.includes('--upload')){
    if(!process.env.DATASET_BUCKET)throw new Error('Set DATASET_BUCKET to upload');
    const {putDatasetObject}=require('../src/aws');
    const prefix=process.env.SOURCE_PREFIX||'source/';
    const type=f=>f.endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    for(const {filename,buffer} of sources)await putDatasetObject(prefix+filename,buffer,type(filename));
    await putDatasetObject(process.env.DATASET_KEY||'ingested.json',JSON.stringify(dataset));
    console.log(`Uploaded ${sources.length} sources and the snapshot to s3://${process.env.DATASET_BUCKET}`);
  }
})().catch(e=>{console.error(e);process.exit(1)});
