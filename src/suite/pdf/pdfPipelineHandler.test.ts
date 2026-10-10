import {describe,expect,it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {handleLocalPdfPipelineData,LOCAL_PDF_PIPELINE_PROTOCOL} from './pdfPipelineHandler';
async function sample(){
  const doc=await PDFDocument.create();
  doc.addPage([100,200]);doc.addPage([200,300]);doc.addPage([300,400]);
  return Uint8Array.from(await doc.save());
}
describe('MALENJO-owned typed offline PDF pipeline transport',()=>{
 it('executes real page operations and returns a reopenable typed PDF payload',async()=>{
   const source=await sample(),copy=Uint8Array.from(source);
   const result=await handleLocalPdfPipelineData({
     protocol:LOCAL_PDF_PIPELINE_PROTOCOL,filename:'source.pdf',
     contentType:'application/pdf',bytes:source,
     planJson:'[{"action":"delete","pages":[2]},{"action":"move","from":2,"to":1}]',
   });
   expect(source).toEqual(copy);
   expect(result.filename).toBe('source-pipeline.pdf');
   expect(result.contentType).toBe('application/pdf');
   expect(result.stepsExecuted).toBe(2);
   expect(result.originalPageCount).toBe(3);
   expect(result.resultPageCount).toBe(2);
   const reopened=await PDFDocument.load(result.bytes);
   expect(reopened.getPages().map(x=>x.getWidth())).toEqual([300,100]);
 });
 it('refuses path traversal, mixed MIME and missing protocol before mutation',async()=>{
   const bytes=await sample();
   const packet={protocol:LOCAL_PDF_PIPELINE_PROTOCOL,contentType:'application/pdf' as const,
     filename:'document.pdf',bytes,planJson:'[{"action":"rotate","pages":[1],"angle":90}]'};
   await expect(handleLocalPdfPipelineData({...packet,filename:'../secret.pdf'})).rejects.toThrow(/safe/);
   await expect(handleLocalPdfPipelineData({...packet,filename:'folder\\secret.pdf'})).rejects.toThrow(/safe/);
   await expect(handleLocalPdfPipelineData({...packet,protocol:'stirling.handleData' as never})).rejects.toThrow(/protocol/);
   await expect(handleLocalPdfPipelineData({...packet,contentType:'text/html' as never})).rejects.toThrow(/MIME/);
   await expect(handleLocalPdfPipelineData({...packet,planJson:'[{"action":"script","value":"alert(1)"}]'}))
     .rejects.toThrow(/unsupported/);
 });
});
