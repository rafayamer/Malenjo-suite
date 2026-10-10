import {describe,expect,it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {inspectPdfDocumentInfo} from './pdfInfo';
import {proposePdfMetadataFilename} from './pdfAutoRename';

async function named(title?:string){
  const pdf=await PDFDocument.create();
  pdf.addPage([200,200]);
  if(title!==undefined)pdf.setTitle(title);
  const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
  return {bytes,info:await inspectPdfDocumentInfo(bytes)};
}
describe('offline metadata-derived PDF auto rename',()=>{
  it('proposes a safe title-derived Windows output without modifying PDF bytes',async()=>{
    const {bytes,info}=await named('Revenue / Q4: <Draft>?');
    const snapshot=Uint8Array.from(bytes);
    expect(proposePdfMetadataFilename(info)).toBe('Revenue Q4 Draft-renamed.pdf');
    expect(bytes).toEqual(snapshot);
  });
  it('blocks Windows device names and strips bidi-control path spoofing',async()=>{
    const {info}=await named('CON.txt');
    expect(proposePdfMetadataFilename(info)).toBe('Document-CON.txt-renamed.pdf');
    const spoof=(await named('report\u202Efdp.exe')).info;
    expect(proposePdfMetadataFilename(spoof)).toBe('reportfdp.exe-renamed.pdf');
  });
  it('preserves Unicode and bounds extremely long titles',async()=>{
    const {info}=await named('Résumé 2026');
    expect(proposePdfMetadataFilename(info)).toBe('Résumé 2026-renamed.pdf');
    const oversized={...info,metadata:{...info.metadata,title:'a'.repeat(500)}};
    expect(proposePdfMetadataFilename(oversized).length).toBeLessThanOrEqual(122);
  });
  it('rejects missing or unsafe document titles rather than silently inventing names',async()=>{
    const {info}=await named();
    expect(()=>proposePdfMetadataFilename(info)).toThrow(/no document title/i);
    const bad={...info,metadata:{...info.metadata,title:'../../\\'}};
    expect(()=>proposePdfMetadataFilename(bad)).toThrow(/safe Windows filename/);
  });
});
