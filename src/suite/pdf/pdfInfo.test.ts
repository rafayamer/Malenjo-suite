import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName,degrees} from 'pdf-lib';
import {
  inspectPdfDocumentInfo,PDF_INFO_MAX_INPUT_BYTES,PDF_INFO_MAX_METADATA_CHARS,
} from './pdfInfo';

describe('offline native PDF information',()=>{
  it('returns real metadata, page sizes and rotations without changing source bytes',async()=>{
    const pdf=await PDFDocument.create();
    pdf.setTitle('Evidence Report');
    pdf.setAuthor('MALENJO');
    pdf.setSubject('Local only');
    pdf.setKeywords(['record','audit']);
    pdf.addPage([612,792]).setRotation(degrees(90));
    pdf.addPage([400,600]);
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const original=Uint8Array.from(bytes);
    const result=await inspectPdfDocumentInfo(bytes);
    expect(result).toMatchObject({
      schemaVersion:1,inspection:'local-pdf-lib',pageCount:2,
      pages:[
        {page:1,widthPt:612,heightPt:792,rotationDegrees:90},
        {page:2,widthPt:400,heightPt:600,rotationDegrees:0},
      ],
      metadata:{title:'Evidence Report',author:'MALENJO',subject:'Local only'},
    });
    expect(bytes).toEqual(original);
  });

  it('reports true physical paper dimensions for non-default UserUnit',async()=>{
    const doc=await PDFDocument.create();const page=doc.addPage([612,792]);
    page.node.set(PDFName.of('UserUnit'),doc.context.obj(2));
    const info=await inspectPdfDocumentInfo(Uint8Array.from(await doc.save()));
    expect(info.pages[0]).toMatchObject({widthPt:1224,heightPt:1584});
  });
  it('rejects corrupt or empty PDFs without fabricating information',async()=>{
    await expect(inspectPdfDocumentInfo(new Uint8Array(0))).rejects.toThrow(/requires a file/i);
    await expect(inspectPdfDocumentInfo(Uint8Array.from([1,2,3]))).rejects.toThrow();
    expect(PDF_INFO_MAX_INPUT_BYTES).toBe(512*1024*1024);
  });

  it('bounds adversarial metadata strings instead of emitting arbitrarily large results',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,300]);
    pdf.setTitle('x'.repeat(PDF_INFO_MAX_METADATA_CHARS+1));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(inspectPdfDocumentInfo(bytes)).rejects.toThrow(/metadata exceeds/i);
  });
});
