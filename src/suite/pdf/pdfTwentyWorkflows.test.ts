import {describe,expect,it} from 'vitest';
import matrix from '../../../docs/pdf-stirling-parity-matrix.json';
import type {PdfProviderOperation,PdfProviderResponse} from './backend';
import {PDF_TWENTY_WORKFLOWS,findPdfBatchOperation,classifyPdfBatchOutput} from './pdfTwentyWorkflows';
import {responseIsPdf} from './stirlingCore';
const pdf=[37,80,68,70,45,49,46,55,10];
const zip=[80,75,3,4,0,0,0,0];
const png=[137,80,78,71,13,10,26,10,0];
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
  it.each(PDF_TWENTY_WORKFLOWS)('$id tests expected success, error, empty and wrong content',workflow=>{
    const good=workflow.output==='zip'?response(zip,'application/zip'):
      workflow.output==='image'?response(png,'image/png'):
      workflow.output==='csv'?response(csv,'text/csv'):
      response(pdf,'application/pdf');
    expect(classifyPdfBatchOutput(workflow,good,responseIsPdf)).toBe(
      workflow.output==='pdf'?'apply-pdf':workflow.output==='copy'?'save-pdf-copy':'save-file',
    );
    expect(()=>classifyPdfBatchOutput(workflow,{...good,status:500},responseIsPdf)).toThrow();
    expect(()=>classifyPdfBatchOutput(workflow,response([]),responseIsPdf)).toThrow();
    expect(()=>classifyPdfBatchOutput(workflow,response([60,104,116,109,108,62],'text/html'),responseIsPdf)).toThrow();
  });
  it('accepts image and ZIP outputs without changing the working PDF',()=>{
    const workflows=PDF_TWENTY_WORKFLOWS.filter(item=>item.output==='image');
    expect(workflows).toHaveLength(2);
    for(const item of workflows){
      expect(classifyPdfBatchOutput(item,response(zip,'application/zip'),responseIsPdf)).toBe('save-file');
      expect(()=>classifyPdfBatchOutput(item,response(pdf,'application/pdf'),responseIsPdf)).toThrow();
    }
  });
  it('rejects false ZIP exports and invalid CSV bytes or MIME',()=>{
    for(const workflow of PDF_TWENTY_WORKFLOWS.filter(item=>item.output==='zip')){
      expect(()=>classifyPdfBatchOutput(workflow,response(png,'application/zip'),responseIsPdf)).toThrow(/ZIP/);
    }
    const workflow=PDF_TWENTY_WORKFLOWS.find(item=>item.id==='pdf-to-csv')!;
    expect(()=>classifyPdfBatchOutput(workflow,response([255,254,0],'text/csv'),responseIsPdf)).toThrow(/UTF-8/);
    expect(()=>classifyPdfBatchOutput(workflow,response(csv,'text/html'),responseIsPdf)).toThrow(/content type/);
    expect(()=>classifyPdfBatchOutput(workflow,response(pdf,'text/csv'),responseIsPdf)).toThrow();
  });
  it('keeps password and sanitization outputs as copies',()=>{
    for(const id of ['add-password','sanitize-pdf']){
      const workflow=PDF_TWENTY_WORKFLOWS.find(item=>item.id===id)!;
      expect(classifyPdfBatchOutput(workflow,response(pdf,'application/pdf'),responseIsPdf)).toBe('save-pdf-copy');
    }
  });
});
