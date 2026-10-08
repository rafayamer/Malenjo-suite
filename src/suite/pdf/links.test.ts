import {describe,expect,it} from 'vitest';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRef,PDFString} from 'pdf-lib';
import {addPdfCommentAnnotation} from './editor';
import {
  addPdfLinkAnnotation,deletePdfLinkAnnotation,listPdfLinkAnnotations,
  updatePdfLinkAnnotation,
} from './links';

async function sample():Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  pdf.addPage([300,400]);
  pdf.addPage([310,420]);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
const bounds={pageNumber:1,x:0.1,y:0.2,width:0.3,height:0.1};

describe('native PDF link annotations',()=>{
  it('creates a genuine internal page link with an indirect PDF destination',async()=>{
    const original=await sample();
    const bytes=await addPdfLinkAnnotation(original,bounds,{kind:'page',pageNumber:2});
    const links=await listPdfLinkAnnotations(bytes);
    expect(links).toMatchObject([{pageNumber:1,index:0,kind:'page',destination:'2'}]);
    expect(links[0].ref).toMatch(/\d+ \d+ R/);
    const document=await PDFDocument.load(bytes);
    const annots=document.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
    const dict=document.context.lookup(annots.get(0),PDFDict);
    expect(dict.get(PDFName.of('Subtype'))?.toString()).toBe('/Link');
    const dest=dict.lookup(PDFName.of('Dest'),PDFArray);
    expect(dest.get(0)?.toString()).toBe(document.getPage(1).ref.toString());
    expect(dest.get(1)?.toString()).toBe('/Fit');
    expect(dict.get(PDFName.of('A'))).toBeUndefined();
    expect(await listPdfLinkAnnotations(original)).toEqual([]);
  });

  it('writes HTTPS-only URI actions and supports editing link targets with a stable ref',async()=>{
    let bytes=await addPdfLinkAnnotation(await sample(),bounds,{
      kind:'https',url:'https://example.org/path?q=1',
    });
    const [link]=await listPdfLinkAnnotations(bytes);
    expect(link).toMatchObject({kind:'https',destination:'https://example.org/path?q=1'});
    bytes=await updatePdfLinkAnnotation(bytes,link,{kind:'page',pageNumber:2});
    const [revised]=await listPdfLinkAnnotations(bytes);
    expect(revised).toMatchObject({kind:'page',destination:'2',ref:link.ref});
    bytes=await updatePdfLinkAnnotation(bytes,revised,{
      kind:'https',url:'https://example.com/new',
    });
    const pdf=await PDFDocument.load(bytes);
    const linkDict=pdf.context.lookup(pdf.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray).get(0),PDFDict);
    const action=linkDict.lookup(PDFName.of('A'),PDFDict);
    expect(action.get(PDFName.of('S'))?.toString()).toBe('/URI');
    expect(action.get(PDFName.of('URI'))).toBeInstanceOf(PDFString);
    expect((action.get(PDFName.of('URI')) as PDFString).decodeText()).toBe('https://example.com/new');
    expect(linkDict.get(PDFName.of('Dest'))).toBeUndefined();
  });

  it('rejects javascript, HTTP, embedded credentials, spaces, invalid pages and rectangles',async()=>{
    const source=await sample();
    for(const url of [
      'javascript:alert(1)','http://example.com','https://user:secret@example.com/',
      'https://example.com/evil path','https://example.com\\@evil.test',
    ])await expect(addPdfLinkAnnotation(source,bounds,{kind:'https',url}))
      .rejects.toThrow(/https|credentials|URL/i);
    await expect(addPdfLinkAnnotation(source,bounds,{kind:'page',pageNumber:3}))
      .rejects.toThrow(/target page/i);
    await expect(addPdfLinkAnnotation(source,{...bounds,x:0.98}, {kind:'page',pageNumber:2}))
      .rejects.toThrow(/rectangle/i);
    expect(await listPdfLinkAnnotations(source)).toEqual([]);
  });

  it('does not execute or overwrite unsupported imported document actions',async()=>{
    const pdf=await PDFDocument.load(await sample());
    const page=pdf.getPage(0);
    const jsLink=pdf.context.obj({
      Type:PDFName.of('Annot'),Subtype:PDFName.of('Link'),Rect:[20,20,40,40],
      A:pdf.context.obj({S:PDFName.of('JavaScript'),JS:PDFString.of('app.alert("no")')}),
    });
    const annots=pdf.context.obj([pdf.context.register(jsLink)]);
    page.node.set(PDFName.of('Annots'),annots);
    const source=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const [link]=await listPdfLinkAnnotations(source);
    expect(link.kind).toBe('unsupported');
    expect(link.destination).toMatch(/unsupported/i);
    await expect(updatePdfLinkAnnotation(source,link,{kind:'page',pageNumber:2}))
      .rejects.toThrow(/unsupported/i);
    const removed=await deletePdfLinkAnnotation(source,link);
    expect(await listPdfLinkAnnotations(removed)).toHaveLength(0);
  });

  it('deletes only the selected link while preserving unrelated annotations',async()=>{
    let bytes=await addPdfCommentAnnotation(await sample(),{
      pageNumber:1,text:'Preserve note',x:0.3,y:0.4,
    });
    bytes=await addPdfLinkAnnotation(bytes,bounds,{kind:'https',url:'https://openai.com'});
    const [link]=await listPdfLinkAnnotations(bytes);
    await expect(deletePdfLinkAnnotation(bytes,{...link,ref:'1000 0 R'}))
      .rejects.toThrow(/identity changed/i);
    const result=await deletePdfLinkAnnotation(bytes,link);
    expect(await listPdfLinkAnnotations(result)).toEqual([]);
    const pdf=await PDFDocument.load(result);
    const annots=pdf.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
    expect(annots.size()).toBe(1);
    const note=pdf.context.lookup(annots.get(0),PDFDict);
    expect(note.get(PDFName.of('Subtype'))?.toString()).toBe('/Text');
    expect(pdf.getPageCount()).toBe(2);
  });

  it('marks direct Link dictionaries as read-only identities',async()=>{
    const pdf=await PDFDocument.load(await sample());
    pdf.getPage(0).node.set(PDFName.of('Annots'),pdf.context.obj([
      pdf.context.obj({
        Subtype:PDFName.of('Link'),Rect:[0,0,20,20],
        Dest:pdf.context.obj([pdf.getPage(1).ref,PDFName.of('Fit')]),
      }),
    ]));
    const source=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const [link]=await listPdfLinkAnnotations(source);
    expect(link).toMatchObject({ref:null,kind:'page',destination:'2'});
    await expect(deletePdfLinkAnnotation(source,link)).rejects.toThrow(/indirect/i);
  });
});
