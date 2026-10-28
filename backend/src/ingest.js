// Shared ingestion: parse the source PDFs and workbook into the dataset snapshot.
// Byte buffers come either from S3 (Lambda) or from disk (local CLI), so the parsing
// rules that classify authority and precedence live in exactly one place.
// Require the library entry point directly: pdf-parse's index.js runs a debug branch that
// reads a sample file when it cannot see a parent module, which a bundled build triggers.
const pdf=require('pdf-parse/lib/pdf-parse.js'),ExcelJS=require('exceljs');
const value=cell=>{const v=cell.value;if(v instanceof Date)return v.toISOString().slice(0,16).replace('T',' ');if(v&&typeof v==='object'&&'result'in v)return v.result;return v??null};
const rows=sheet=>{const headers=sheet.getRow(1).values.slice(1).map(String);const data=[];sheet.eachRow((row,n)=>{if(n===1)return;const item={};headers.forEach((h,i)=>item[h]=value(row.getCell(i+1)));data.push(item)});return data};

function classify(filename){
  const kind=filename.includes('DEPRECATED')?'deprecated':filename.includes('Agreement')?'agreement':filename.includes('SOP')?'sop':filename.includes('Policy')?'policy':'product';
  return {kind,account_id:filename.includes('Northstar')?'ACCT-001':filename.includes('LumenWorks')?'ACCT-002':null,authority:kind==='agreement'?100:kind==='sop'?90:kind==='policy'?80:kind==='product'?70:0};
}

async function buildDataset(sources){
  const documents=[];
  for(const {filename,buffer} of sources.filter(x=>x.filename.endsWith('.pdf')).sort((a,b)=>a.filename.localeCompare(b.filename))){
    const text=(await pdf(buffer)).text.replace(/\s+/g,' ').trim();
    documents.push({id:filename.slice(0,2),filename,title:filename.replace(/_/g,' ').replace('.pdf',''),...classify(filename),text});
  }
  const workbook=sources.find(x=>x.filename.endsWith('.xlsx'));
  if(!workbook)throw new Error('Source workbook not found');
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(workbook.buffer);
  const readme=wb.getWorksheet('README');let snapshot=null;
  readme.eachRow(row=>{if(value(row.getCell(1))==='Dataset snapshot')snapshot=value(row.getCell(2))});
  return {snapshot,currency:'INR',ingestedAt:new Date().toISOString(),accounts:rows(wb.getWorksheet('accounts')),orders:rows(wb.getWorksheet('orders')),tickets:rows(wb.getWorksheet('tickets')),documents};
}
module.exports={buildDataset,classify};
