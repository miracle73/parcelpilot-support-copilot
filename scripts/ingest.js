const fs=require('fs'),path=require('path'),pdf=require('pdf-parse'),ExcelJS=require('exceljs');
const root=path.join(__dirname,'..','data','source'),out=path.join(__dirname,'..','data','ingested.json');
const value=cell=>{const v=cell.value;if(v instanceof Date)return v.toISOString().slice(0,16).replace('T',' ');if(v&&typeof v==='object'&&'result'in v)return v.result;return v??null};
const rows=sheet=>{const headers=sheet.getRow(1).values.slice(1).map(String);const data=[];sheet.eachRow((row,n)=>{if(n===1)return;const item={};headers.forEach((h,i)=>item[h]=value(row.getCell(i+1)));data.push(item)});return data};
(async()=>{
  const files=fs.readdirSync(root),documents=[];
  for(const filename of files.filter(x=>x.endsWith('.pdf')).sort()){
    const text=(await pdf(fs.readFileSync(path.join(root,filename)))).text.replace(/\s+/g,' ').trim();
    const kind=filename.includes('DEPRECATED')?'deprecated':filename.includes('Agreement')?'agreement':filename.includes('SOP')?'sop':filename.includes('Policy')?'policy':'product';
    documents.push({id:filename.slice(0,2),filename,title:filename.replace(/_/g,' ').replace('.pdf',''),kind,account_id:filename.includes('Northstar')?'ACCT-001':filename.includes('LumenWorks')?'ACCT-002':null,authority:kind==='agreement'?100:kind==='sop'?90:kind==='policy'?80:kind==='product'?70:0,text});
  }
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(root,'ParcelPilot_Assessment_Data.xlsx'));
  const readme=wb.getWorksheet('README');let snapshot=null;readme.eachRow(row=>{if(value(row.getCell(1))==='Dataset snapshot')snapshot=value(row.getCell(2))});
  const result={snapshot,currency:'INR',accounts:rows(wb.getWorksheet('accounts')),orders:rows(wb.getWorksheet('orders')),tickets:rows(wb.getWorksheet('tickets')),documents};
  fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(`Ingested ${documents.length} documents, ${result.accounts.length} accounts, ${result.orders.length} orders, and ${result.tickets.length} tickets`);
})().catch(e=>{console.error(e);process.exit(1)});
