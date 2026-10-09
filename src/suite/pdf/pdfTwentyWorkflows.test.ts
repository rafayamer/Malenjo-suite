import {zipSync,strToU8,zlibSync} from 'fflate';
import {PDFDocument} from 'pdf-lib';
import {describe,expect,it} from 'vitest';
import matrix from '../../../docs/pdf-stirling-parity-matrix.json';
import type {PdfProviderOperation,PdfProviderResponse} from './backend';
import {PDF_TWENTY_WORKFLOWS,findPdfBatchOperation,classifyPdfBatchOutput,verifyPdfBatchZip} from './pdfTwentyWorkflows';
import {responseIsPdf} from './stirlingCore';
const pdf=Array.from(await (async()=>{const d=await PDFDocument.create();d.addPage([200,200]);return d.save();})());
const zip=Array.from(zipSync({'one.pdf':Uint8Array.from(pdf)}));
function validPng():number[]{
  const be=(x:number)=>[(x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255];
  const chunk=(name:string,data:number[]):number[]=>{
    const payload=[...Array.from(name).map(c=>c.charCodeAt(0)),...data];
    let crc=0xffffffff;
    for(const value of payload){crc^=value;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    return [...be(data.length),...payload,...be((crc^0xffffffff)>>>0)];
  };
  return [137,80,78,71,13,10,26,10,
    ...chunk('IHDR',[...be(1),...be(1),8,6,0,0,0]),
    ...chunk('IDAT',Array.from(zlibSync(Uint8Array.from([0,200,80,40,255])))),
    ...chunk('IEND',[])];
}
const png=validPng();
const csv=Array.from(new TextEncoder().encode('page,text\n1,hello\n'));
const response=(bytes:number[],contentType='application/octet-stream',status=200):PdfProviderResponse=>({bytes,contentType,status});
function live(path:string,method:'POST'|'GET'='POST'):PdfProviderOperation{
  return {id:path,summary:path,path,method,description:'',tags:[],category:'organize',fields:[],
    capability:{available:true,implementation:'core',providerId:'stirling-core',legalReference:'audit'}};
}
describe('20 source-pinned PDF processing workflows',()=>{
  it('includes exactly 20 unique pinned upstream requirement IDs and paths',()=>{
    expect(PDF_TWENTY_WORKFLOWS).toHaveLength(20);
    expect(new Set(PDF_TWENTY_WORKFLOWS.map(item=>item.id)).size).toBe(20);
    expect(new Set(PDF_TWENTY_WORKFLOWS.map(item=>item.path)).size).toBe(20);
    for(const workflow of PDF_TWENTY_WORKFLOWS){
      const item=matrix.operations.find(row=>row.upstreamToolId===workflow.id);
      expect(item?.source.upstreamEndpoint).toBe(workflow.path);
      expect(item?.evidence.functionalStatus).not.toBe('implemented');
      expect(item?.evidence.windowsOffline).toBe('unverified');
    }
  });
  it.each(PDF_TWENTY_WORKFLOWS)('$id only resolves an unambiguous exact live POST API operation',workflow=>{
    const operation=live(workflow.path);
    expect(findPdfBatchOperation(workflow,[operation])).toBe(operation);
    expect(findPdfBatchOperation(workflow,[])).toBeNull();
    expect(findPdfBatchOperation(workflow,[live(workflow.path,'GET')])).toBeNull();
    expect(findPdfBatchOperation(workflow,[operation,live(workflow.path)])).toBeNull();
    expect(findPdfBatchOperation(workflow,[live(workflow.path+'-unsafe')])).toBeNull();
  });
  it.each(PDF_TWENTY_WORKFLOWS)('$id tests expected success, error, empty and wrong content',async workflow=>{
    const good=workflow.output==='zip'?response(zip,'application/zip'):
      workflow.output==='image'?response(png,'image/png'):
      workflow.output==='csv'?response(csv,'text/csv'):
      response(pdf,'application/pdf');
    expect(await classifyPdfBatchOutput(workflow,good,responseIsPdf)).toBe(
      workflow.output==='pdf'?'apply-pdf':workflow.output==='copy'?'save-pdf-copy':'save-file',
    );
    await expect(classifyPdfBatchOutput(workflow,{...good,status:500},responseIsPdf)).rejects.toThrow();
    await expect(classifyPdfBatchOutput(workflow,response([]),responseIsPdf)).rejects.toThrow();
    await expect(classifyPdfBatchOutput(workflow,response([60,104,116,109,108,62],'text/html'),responseIsPdf)).rejects.toThrow();
  });
  it('accepts image and ZIP outputs without changing the working PDF',async()=>{
    const workflows=PDF_TWENTY_WORKFLOWS.filter(item=>item.output==='image');
    expect(workflows).toHaveLength(2);
    for(const item of workflows){
      expect(await classifyPdfBatchOutput(item,response(Array.from(zipSync({'sample.png':Uint8Array.from(png)})),'application/zip'),responseIsPdf)).toBe('save-file');
      await expect(classifyPdfBatchOutput(item,response(pdf,'application/pdf'),responseIsPdf)).rejects.toThrow();
    }
  });
  it('rejects false ZIP exports and invalid CSV bytes or MIME',async()=>{
    for(const workflow of PDF_TWENTY_WORKFLOWS.filter(item=>item.output==='zip')){
      await expect(classifyPdfBatchOutput(workflow,response(png,'application/zip'),responseIsPdf)).rejects.toThrow(/ZIP/);
    }
    const workflow=PDF_TWENTY_WORKFLOWS.find(item=>item.id==='pdf-to-csv')!;
    await expect(classifyPdfBatchOutput(workflow,response([255,254,0],'text/csv'),responseIsPdf)).rejects.toThrow(/UTF-8/);
    await expect(classifyPdfBatchOutput(workflow,response(csv,'text/html'),responseIsPdf)).rejects.toThrow(/content type/);
    await expect(classifyPdfBatchOutput(workflow,response(pdf,'text/csv'),responseIsPdf)).rejects.toThrow();
  });
  it('does not accept truncated protected or sanitized copies',async()=>{
    for(const id of ['sanitize-pdf','add-password']){
      const workflow=PDF_TWENTY_WORKFLOWS.find(item=>item.id===id)!;
      await expect(classifyPdfBatchOutput(workflow,response([37,80,68,70,45],'application/pdf'),responseIsPdf)).rejects.toThrow();
    }
  });
  it('rejects truncated, empty, corrupt and non-PDF split archives before saving',async()=>{
    await expect(verifyPdfBatchZip([80,75,3,4,0,0,0,0])).rejects.toThrow(/invalid|unsafe/i);
    await expect(verifyPdfBatchZip(Array.from(zipSync({})))).rejects.toThrow(/no valid/i);
    await expect(verifyPdfBatchZip(Array.from(zipSync({'evil.pdf':strToU8('<html>')})))).rejects.toThrow(/unreadable PDF/i);
    await expect(verifyPdfBatchZip(Array.from(zipSync({'evil.txt':strToU8('hi')})))).rejects.toThrow(/file type/i);
    await expect(verifyPdfBatchZip(zip)).resolves.toBeUndefined();
    await expect(verifyPdfBatchZip(Array.from(zipSync({'bad.pdf':strToU8('%PDF-')})))).rejects.toThrow(/unreadable PDF/);
    await expect(verifyPdfBatchZip([80,75,3,4,0,0], 'image')).rejects.toThrow();
    await expect(verifyPdfBatchZip(Array.from(zipSync({'broken.png':Uint8Array.from(png.slice(0,20))})),'image')).rejects.toThrow(/incomplete/);
    await expect(verifyPdfBatchZip(Array.from(zipSync({'image.png':Uint8Array.from(png)})),'image')).resolves.toBeUndefined();
  });
  it('rejects fake protected copy results while allowing verified sanitized PDFs',async()=>{
    for(const id of ['add-password','sanitize-pdf']){
      const workflow=PDF_TWENTY_WORKFLOWS.find(item=>item.id===id)!;
      if(id==='sanitize-pdf')expect(await classifyPdfBatchOutput(workflow,response(pdf,'application/pdf'),responseIsPdf)).toBe('save-pdf-copy');
      else await expect(classifyPdfBatchOutput(workflow,response(pdf,'application/pdf'),responseIsPdf)).rejects.toThrow(/Password protection/);
    }
  });
});
