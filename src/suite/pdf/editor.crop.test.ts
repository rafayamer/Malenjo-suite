import {describe,expect,it} from 'vitest';
import {PDFDocument,degrees} from 'pdf-lib';
import {inspectPdfVisualCropPage,setPdfPageBox} from './editor';

describe('PDF visual crop safety',()=>{
  it('supports an uncropped, unrotated source using actual MediaBox points',async()=>{
    const doc=await PDFDocument.create();
    doc.addPage([612,792]);
    const source=Uint8Array.from(await doc.save());
    expect(await inspectPdfVisualCropPage(source,1)).toEqual({width:612,height:792,visualSupported:true,reason:''});
    const changed=await setPdfPageBox(source,{pageNumbers:[1],box:'crop',left:36,top:72,right:18,bottom:24});
    const reopened=await PDFDocument.load(changed);
    expect(reopened.getPage(0).getCropBox()).toMatchObject({x:36,y:24,width:558,height:696});
    expect((await PDFDocument.load(source)).getPage(0).getCropBox().width).toBe(612);
    expect((await inspectPdfVisualCropPage(changed,1)).visualSupported).toBe(false);
  });
  it('does not offer inaccurate drag geometry for natively rotated pages',async()=>{
    const doc=await PDFDocument.create();
    const page=doc.addPage([300,400]);
    page.setRotation(degrees(90));
    const inspected=await inspectPdfVisualCropPage(Uint8Array.from(await doc.save()),1);
    expect(inspected.visualSupported).toBe(false);
    expect(inspected.reason).toMatch(/rotation/);
  });
});
