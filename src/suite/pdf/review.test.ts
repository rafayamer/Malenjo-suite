import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { addPdfCommentAnnotation } from './editor';
import {
  addPdfRegionMarkup, deletePdfReviewAnnotation, listPdfReviewAnnotations,
  setPdfReviewResolved, updatePdfReviewText, replyToPdfReviewAnnotation,
} from './review';

async function sample(pages=2):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  for(let i=0;i<pages;i++)pdf.addPage([320,480]);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

describe('PDF review lifecycle',()=>{
  it('lists, edits, resolves, reopens and deletes real PDF comments',async()=>{
    const base=await sample();
    const added=await addPdfCommentAnnotation(base,{
      pageNumber:2,text:'Verify contract clause',author:'Reviewer',x:0.2,y:0.4,
    });
    const initial=await listPdfReviewAnnotations(added);
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      pageNumber:2,kind:'Text',author:'Reviewer',text:'Verify contract clause',resolved:false,
    });
    expect(initial[0].ref).toMatch(/ R$/);

    const edited=await updatePdfReviewText(added,initial[0],'Updated – verify confidentiality');
    expect((await listPdfReviewAnnotations(edited))[0].text).toBe('Updated – verify confidentiality');
    const resolved=await setPdfReviewResolved(edited,initial[0],true);
    expect((await listPdfReviewAnnotations(resolved))[0].resolved).toBe(true);
    const reopened=await setPdfReviewResolved(resolved,initial[0],false);
    expect((await listPdfReviewAnnotations(reopened))[0].resolved).toBe(false);
    const deleted=await deletePdfReviewAnnotation(reopened,initial[0]);
    expect(await listPdfReviewAnnotations(deleted)).toHaveLength(0);
    expect(await listPdfReviewAnnotations(added)).toHaveLength(1);
  });

  it('reads legacy MALENJO PDF names used as comment strings',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([320,480]);
    const annotation=pdf.context.obj({
      Type:PDFName.of('Annot'),
      Subtype:PDFName.of('Text'),
      Rect:[10,10,30,30],
      Contents:'Legacy comment text',
      T:'Previous reviewer',
    });
    const annots=pdf.context.obj([pdf.context.register(annotation)]);
    page.node.set(PDFName.of('Annots'),annots);
    const legacy=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const list=await listPdfReviewAnnotations(legacy);
    expect(list[0]).toMatchObject({text:'Legacy comment text',author:'Previous reviewer'});
    const changed=await updatePdfReviewText(legacy,list[0],'Converted to Unicode');
    expect((await listPdfReviewAnnotations(changed))[0].text).toBe('Converted to Unicode');
  });

  it('creates standard PDF markup with a real QuadPoints array',async()=>{
    const base=await sample(1);
    const added=await addPdfRegionMarkup(base,{
      pageNumber:1,kind:'Highlight',x:0.1,y:0.6,width:0.4,height:0.05,
      text:'Highlight selected rectangle',author:'Examiner',
    });
    const list=await listPdfReviewAnnotations(added);
    expect(list).toMatchObject([{kind:'Highlight',text:'Highlight selected rectangle'}]);
    const pdf=await PDFDocument.load(added);
    const annots=pdf.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
    const ref=annots.get(0);
    expect(ref).toBeInstanceOf(PDFRef);
    const dict=pdf.context.lookup(ref,PDFDict);
    const quad=dict.lookup(PDFName.of('QuadPoints'),PDFArray);
    expect(quad.size()).toBe(8);
    expect(dict.get(PDFName.of('Subtype'))?.toString()).toBe('/Highlight');
    const removed=await deletePdfReviewAnnotation(added,list[0]);
    expect(await listPdfReviewAnnotations(removed)).toEqual([]);
  });

  it('preserves unrelated AcroForm widget annotations',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([320,480]);
    const field=pdf.getForm().createTextField('customer-name');
    field.addToPage(page,{x:30,y:300,width:200,height:30});
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await listPdfReviewAnnotations(bytes)).toEqual([]);
    const marked=await addPdfRegionMarkup(bytes,{
      pageNumber:1,kind:'Underline',x:0.1,y:0.4,width:0.5,height:0.03,
    });
    const reviewed=await listPdfReviewAnnotations(marked);
    const removed=await deletePdfReviewAnnotation(marked,reviewed[0]);
    const restored=await PDFDocument.load(removed);
    expect(restored.getForm().getFields()).toHaveLength(1);
    expect(restored.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray).size()).toBe(1);
  });

  it('rejects stale IDs, altered subtypes, bad coordinates and empty text',async()=>{
    const bytes=await addPdfCommentAnnotation(await sample(1),{
      pageNumber:1,text:'Keep',x:0.3,y:0.3,
    });
    const [item]=await listPdfReviewAnnotations(bytes);
    const bad={...item,ref:'999 0 R'};
    await expect(deletePdfReviewAnnotation(bytes,bad)).rejects.toThrow(/identity changed/i);
    await expect(updatePdfReviewText(bytes,{...item,kind:'Highlight'},'Oops')).rejects.toThrow(/subtype changed/i);
    await expect(updatePdfReviewText(bytes,item,'  ')).rejects.toThrow(/must not be empty/i);
    await expect(addPdfRegionMarkup(bytes,{
      pageNumber:1,kind:'StrikeOut',x:0.9,y:0.5,width:0.2,height:0.1,
    })).rejects.toThrow(/inside/i);
    expect((await listPdfReviewAnnotations(bytes))[0].text).toBe('Keep');
  });

  it('does not silently return a partial annotation inventory over page limits',async()=>{
    const pdf=await PDFDocument.create();
    for(let i=0;i<2001;i++)pdf.addPage([72,72]);
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(listPdfReviewAnnotations(bytes)).rejects.toThrow(/no partial list/i);
  });

  it('creates a real Unicode /IRT reply and keeps the parent annotation editable',async()=>{
    const source=await addPdfCommentAnnotation(await sample(1),{
      pageNumber:1,text:'Review contract',author:'Reviewer',x:0.2,y:0.4,
    });
    const [parent]=await listPdfReviewAnnotations(source);
    const replied=await replyToPdfReviewAnnotation(source,parent,'Acknowledged — résumé','Co-author');
    const rows=await listPdfReviewAnnotations(replied);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      kind:'Text',text:'Acknowledged — résumé',author:'Co-author',
      replyToRef:parent.ref,pageNumber:1,
    });
    const pdf=await PDFDocument.load(replied);
    const annots=pdf.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
    const child=pdf.context.lookup(annots.get(1),PDFDict);
    expect(child.get(PDFName.of('IRT'))?.toString()).toBe(parent.ref);
    expect(child.get(PDFName.of('RT'))?.toString()).toBe('/R');
    await expect(deletePdfReviewAnnotation(replied,parent)).rejects.toThrow(/replies first/i);
    const withoutReply=await deletePdfReviewAnnotation(replied,rows[1]);
    const withoutParent=await deletePdfReviewAnnotation(withoutReply,parent);
    expect(await listPdfReviewAnnotations(withoutParent)).toHaveLength(0);
    expect((await listPdfReviewAnnotations(source))[0].text).toBe('Review contract');
  });

  it('rejects missing, stale, empty and overlong parent replies',async()=>{
    const source=await addPdfCommentAnnotation(await sample(1),{
      pageNumber:1,text:'Parent',x:0.1,y:0.1,
    });
    const [parent]=await listPdfReviewAnnotations(source);
    await expect(replyToPdfReviewAnnotation(source,{...parent,ref:'800 0 R'},'Hello'))
      .rejects.toThrow(/identity changed/i);
    await expect(replyToPdfReviewAnnotation(source,parent,'  '))
      .rejects.toThrow(/must not be empty/i);
    await expect(replyToPdfReviewAnnotation(source,parent,'X'.repeat(4001)))
      .rejects.toThrow(/exceeds/i);
    expect(await listPdfReviewAnnotations(source)).toHaveLength(1);
  });

});
