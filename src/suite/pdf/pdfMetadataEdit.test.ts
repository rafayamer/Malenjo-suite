import {describe,expect,it} from 'vitest';
import {PDFDict,PDFDocument,PDFName,degrees} from 'pdf-lib';
import {updatePdfBasicMetadata} from './pdfMetadataEdit';
import type {PdfBasicMetadataUpdate} from './pdfMetadataEdit';
import {inspectPdfDocumentInfo} from './pdfInfo';

const next:PdfBasicMetadataUpdate={
  title:'Revised report',author:'MALENJO',subject:'Locally updated',
  keywords:'offline, pdf, metadata',
};

describe('offline PDF Info-dictionary metadata editing',()=>{
  it('changes real PDF metadata, keeps both A4 pages, and produces a reopenable file',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([595.28,841.89]).setRotation(degrees(90));
    pdf.addPage([595.28,841.89]);
    pdf.setTitle('Original report');
    pdf.setAuthor('Jane');
    pdf.setSubject('Draft');
    pdf.setKeywords(['draft']);
    pdf.setCreator('Original PDF creator');
    pdf.setProducer('Original PDF producer');
    pdf.setCreationDate(new Date('2022-05-10T10:20:30Z'));
    const before=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const unchanged=Uint8Array.from(before);

    const after=await updatePdfBasicMetadata(before,next);
    const parsed=await PDFDocument.load(after,{updateMetadata:false});
    const metadata=await inspectPdfDocumentInfo(after);
    expect(metadata.metadata).toMatchObject({
      title:next.title,author:next.author,subject:next.subject,
      creator:'Original PDF creator',producer:'Original PDF producer',
      createdAt:'2022-05-10T10:20:30.000Z',
    });
    expect(metadata.metadata.keywords).toContain('offline');
    expect(parsed.getPageCount()).toBe(2);
    expect(parsed.getPage(0).getRotation().angle).toBe(90);
    expect(parsed.getPage(0).getSize().height).toBeCloseTo(841.89,1);
    expect(before).toEqual(unchanged);
    expect(after).not.toEqual(before);
  });

  it('clears selected fields but preserves untouched creator, producer and creation date',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    pdf.setTitle('Private');
    pdf.setAuthor('Private');
    pdf.setSubject('Private');
    pdf.setKeywords(['private']);
    pdf.setCreator('Existing creator');
    pdf.setProducer('Existing producer');
    const before=Uint8Array.from(await pdf.save());
    const edited=await updatePdfBasicMetadata(before,{
      title:'',author:'',subject:'',keywords:'',
    });
    const reopened=await PDFDocument.load(edited,{updateMetadata:false});
    expect(reopened.getTitle()).toBe('');
    expect(reopened.getAuthor()).toBe('');
    expect(reopened.getSubject()).toBe('');
    expect(reopened.getCreator()).toBe('Existing creator');
    expect(reopened.getProducer()).toBe('Existing producer');
  });

  it('rejects invalid inputs and oversize values before changing the source',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage();
    pdf.setTitle('Original');
    const bytes=Uint8Array.from(await pdf.save());
    await expect(updatePdfBasicMetadata(new Uint8Array(),next)).rejects.toThrow(/requires a PDF/i);
    await expect(updatePdfBasicMetadata(Uint8Array.from([1,2,3,4,5]),next)).rejects.toThrow();
    await expect(updatePdfBasicMetadata(bytes,{...next,author:'x'.repeat(4097)})).rejects.toThrow(/4,096/);
    await expect(updatePdfBasicMetadata(bytes,{...next,title:'x\u0000y'})).rejects.toThrow(/null character/);
    await expect(updatePdfBasicMetadata(bytes,{
      title:'Original',author:'',subject:'',keywords:'',
    })).rejects.toThrow(/No PDF metadata values were changed/i);
  });

  it('blocks PDF signature dictionaries rather than silently invalidating signing evidence',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage();
    const signedObject:PDFDict=pdf.context.obj({
      Type:PDFName.of('Sig'),
      ByteRange:[0,5,100,5],
    });
    pdf.context.register(signedObject);
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(updatePdfBasicMetadata(bytes,next)).rejects.toThrow(/signature field or byte range/i);
  });
});
