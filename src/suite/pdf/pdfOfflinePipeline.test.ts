import {describe,expect,it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {parseOfflinePdfPipeline,runOfflinePdfPipeline} from './pdfOfflinePipeline';

async function sample():Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  pdf.addPage([100,150]);
  pdf.addPage([200,250]);
  pdf.addPage([300,350]);
  return Uint8Array.from(await pdf.save());
}

describe('offline multi-tool PDF page pipeline',()=>{
  it('combines move, rotate and delete, then reopens the real output in order',async()=>{
    const source=await sample();
    const original=Uint8Array.from(source);
    const plan=parseOfflinePdfPipeline(JSON.stringify([
      {action:'move',from:1,to:3},
      {action:'rotate',pages:[3],angle:90},
      {action:'delete',pages:[1]},
    ]));
    const result=await runOfflinePdfPipeline(source,plan);
    expect(source).toEqual(original);
    const reopened=await PDFDocument.load(result);
    expect(reopened.getPageCount()).toBe(2);
    expect(reopened.getPage(0).getSize()).toEqual({width:300,height:350});
    expect(reopened.getPage(1).getSize()).toEqual({width:100,height:150});
    expect(reopened.getPage(1).getRotation().angle).toBe(90);
  });
  it('validates schema without executing arbitrary actions or unexpected options',()=>{
    expect(parseOfflinePdfPipeline('[{"action":"rotate","pages":[1,2],"angle":180}]'))
      .toEqual([{action:'rotate',pages:[1,2],angle:180}]);
    for(const json of [
      '', '{broken', '{}', '[]',
      '[{"action":"shell","command":"rm -rf /"}]',
      '[{"action":"delete","pages":[1,1]}]',
      '[{"action":"delete","pages":[0]}]',
      '[{"action":"rotate","pages":[1],"angle":45}]',
      '[{"action":"rotate","pages":[1],"angle":90,"extra":"unsafe"}]',
      '[{"action":"move","from":1,"to":2.5}]',
      JSON.stringify(Array.from({length:21},()=>({action:'delete',pages:[1]}))),
    ]){
      expect(()=>parseOfflinePdfPipeline(json)).toThrow();
    }
  });
  it('refuses deleting every page, invalid step order and non-existing page numbers',async()=>{
    const source=await sample();
    await expect(runOfflinePdfPipeline(source,[{action:'delete',pages:[1,2,3]}]))
      .rejects.toThrow(/delete every/);
    await expect(runOfflinePdfPipeline(source,[{action:'rotate',pages:[4],angle:90}]))
      .rejects.toThrow(/missing page/);
    await expect(runOfflinePdfPipeline(source,[
      {action:'delete',pages:[3]},
      {action:'move',from:1,to:3},
    ])).rejects.toThrow(/missing page/);
  });
  it('refuses documents with form fields or interactive structures',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([100,100]);
    pdf.getForm().createTextField('secret');
    const bytes=Uint8Array.from(await pdf.save());
    await expect(runOfflinePdfPipeline(bytes,[{action:'rotate',pages:[1],angle:90}]))
      .rejects.toThrow(/AcroForm/);
  });
  it('rejects invalid and oversized inputs before editing',async()=>{
    await expect(runOfflinePdfPipeline(new Uint8Array(),[{action:'delete',pages:[1]}]))
      .rejects.toThrow(/32 MB/);
    await expect(runOfflinePdfPipeline(new Uint8Array(32*1024*1024+1),[{action:'delete',pages:[1]}]))
      .rejects.toThrow(/32 MB/);
    await expect(runOfflinePdfPipeline(await sample(),[]))
      .rejects.toThrow(/1 to 20/);
  });
});
