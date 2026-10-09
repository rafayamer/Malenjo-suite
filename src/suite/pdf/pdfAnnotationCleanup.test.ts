import {describe,expect,it} from 'vitest';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRef} from 'pdf-lib';
import {removePdfReviewMarkup} from './pdfAnnotationCleanup';

const annotsKey=PDFName.of('Annots');
const subtypeKey=PDFName.of('Subtype');
const parentKey=PDFName.of('Parent');

function types(pdf:PDFDocument,pageNumber=0):string[]{
  const array=pdf.getPage(pageNumber).node.lookupMaybe(annotsKey,PDFArray);
  if(!array)return [];
  return Array.from({length:array.size()},(_,i)=>
    pdf.context.lookup(array.get(i),PDFDict).get(subtypeKey)?.toString()??'unknown');
}
function addAnnotation(pdf:PDFDocument,array:PDFArray,subtype:string,parent?:PDFRef):PDFRef{
  const dictionary=pdf.context.obj({
    Type:PDFName.of('Annot'),
    Subtype:PDFName.of(subtype),
    Rect:[10,10,30,30],
    ...(parent?{Parent:parent}:{}),
  });
  const ref=pdf.context.register(dictionary);
  array.push(ref);
  return ref;
}

describe('offline PDF review annotation cleanup',()=>{
  it('removes notes, highlights and their popups while preserving links, form widgets and page content',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([595,842]);
    const next=pdf.addPage([595,842]);
    pdf.setTitle('Page content must be kept');
    const form=pdf.getForm();
    const consent=form.createCheckBox('consent');
    consent.addToPage(page,{x:100,y:200,width:15,height:15});
    consent.check();
    const annots=page.node.lookup(annotsKey,PDFArray);
    const note=addAnnotation(pdf,annots,'Text');
    addAnnotation(pdf,annots,'Popup',note);
    addAnnotation(pdf,annots,'Highlight');
    addAnnotation(pdf,annots,'Link');
    const other=pdf.context.obj([ ]);
    next.node.set(annotsKey,other);
    addAnnotation(pdf,other,'FreeText');
    const input=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const snapshot=Uint8Array.from(input);

    const result=await removePdfReviewMarkup(input);
    const output=await PDFDocument.load(result.bytes,{updateMetadata:false});
    expect(result.removed).toBe(4);
    expect(output.getPageCount()).toBe(2);
    expect(output.getTitle()).toBe('Page content must be kept');
    expect(types(output)).toEqual(expect.arrayContaining(['/Widget','/Link']));
    expect(types(output)).toHaveLength(2);
    expect(types(output,1)).toHaveLength(0);
    expect(output.getForm().getCheckBox('consent').isChecked()).toBe(true);
    expect(input).toEqual(snapshot);
  });

  it('preserves Popup annotations when their parent annotation is not removed',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([400,400]);
    const arr=pdf.context.obj([]);
    page.node.set(annotsKey,arr);
    const link=addAnnotation(pdf,arr,'Link');
    addAnnotation(pdf,arr,'Popup',link);
    addAnnotation(pdf,arr,'Underline');
    const result=await removePdfReviewMarkup(Uint8Array.from(await pdf.save()));
    expect(result.removed).toBe(1);
    const output=await PDFDocument.load(result.bytes);
    expect(types(output)).toEqual(['/Link','/Popup']);
    expect(output.getPage(0).getSize()).toEqual({width:400,height:400});
  });

  it('rejects empty, invalid and unchanged files without fabricating a result',async()=>{
    await expect(removePdfReviewMarkup(new Uint8Array())).rejects.toThrow(/requires a PDF/);
    await expect(removePdfReviewMarkup(Uint8Array.from([1,2,3,4,5]))).rejects.toThrow();
    const pdf=await PDFDocument.create();
    pdf.addPage();
    const original=Uint8Array.from(await pdf.save());
    await expect(removePdfReviewMarkup(original)).rejects.toThrow(/no supported review/);
  });

  it('refuses mixed redaction and review markup rather than leaving unannounced redaction annotations',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([595,842]);
    const annotations=pdf.context.obj([]);
    page.node.set(annotsKey,annotations);
    addAnnotation(pdf,annotations,'Text');
    addAnnotation(pdf,annotations,'Redact');
    const original=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const snapshot=Uint8Array.from(original);
    await expect(removePdfReviewMarkup(original)).rejects.toThrow(/unapplied redaction markup/i);
    expect(original).toEqual(snapshot);
    const reopened=await PDFDocument.load(original);
    expect(types(reopened)).toEqual(['/Text','/Redact']);
  });

  it('refuses signature-bearing PDFs rather than breaking document signatures',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage();
    const arr=pdf.context.obj([]);
    page.node.set(annotsKey,arr);
    addAnnotation(pdf,arr,'Text');
    const signature=pdf.context.obj({
      Type:PDFName.of('Sig'),
      ByteRange:[0,5,100,5],
    });
    pdf.context.register(signature);
    const original=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(removePdfReviewMarkup(original)).rejects.toThrow(/signature field or byte range/);
  });
});
