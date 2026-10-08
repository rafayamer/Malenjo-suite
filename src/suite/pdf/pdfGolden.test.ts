import {describe,expect,it} from 'vitest';
import {PDFArray,PDFDict,PDFDocument,PDFName} from 'pdf-lib';
import {addPdfTextField,addPdfCommentAnnotation} from './editor';
import {addPdfTopLevelBookmark,listPdfTopLevelBookmarks} from './bookmarkEditor';
import {setPdfPageLabelRange,listPdfPageLabelRanges} from './pageLabels';
import {listPdfReviewAnnotations,replyToPdfReviewAnnotation,addPdfRegionMarkup} from './review';
import {deletePdfExistingFormField,updatePdfExistingFieldProperties} from './formManagement';
import {createPdfHistory,recordPdfHistory,undoPdfHistory,redoPdfHistory} from './history';

describe('cross-feature PDF export / re-open regression',()=>{
  it('preserves bookmarks, labels, review thread and page objects when a form field is edited and deleted',async()=>{
    const created=await PDFDocument.create();
    created.addPage([450,600]);
    created.addPage([450,600]);
    const original=Uint8Array.from(await created.save({useObjectStreams:false}));
    let bytes=await addPdfTextField(original,{
      name:'case.owner',pageNumber:1,x:0.1,y:0.4,width:0.4,height:0.07,defaultValue:'Alice',
    });
    bytes=await addPdfTopLevelBookmark(bytes,'Résumé',2);
    bytes=await setPdfPageLabelRange(bytes,{
      startPage:1,style:'r',prefix:'Front ',startNumber:1,
    });
    bytes=await addPdfCommentAnnotation(bytes,{
      pageNumber:1,text:'Verify this page',author:'Reviewer',x:0.2,y:0.7,
    });
    let comments=await listPdfReviewAnnotations(bytes);
    bytes=await replyToPdfReviewAnnotation(bytes,comments[0],'Confirmed','Auditor');
    bytes=await addPdfRegionMarkup(bytes,{
      pageNumber:1,kind:'Highlight',x:0.2,y:0.6,width:0.35,height:0.05,text:'Check',
    });
    bytes=await updatePdfExistingFieldProperties(bytes,{
      name:'case.owner',readOnly:true,required:true,
    });
    const edited=await PDFDocument.load(bytes);
    expect(edited.getForm().getTextField('case.owner').getText()).toBe('Alice');
    expect(edited.getForm().getTextField('case.owner').isRequired()).toBe(true);
    expect((await listPdfTopLevelBookmarks(bytes))[0].title).toBe('Résumé');
    expect((await listPdfPageLabelRanges(bytes))[0]).toMatchObject({style:'r',prefix:'Front '});
    comments=await listPdfReviewAnnotations(bytes);
    expect(comments).toHaveLength(3);
    expect(comments[1].replyToRef).toBe(comments[0].ref);

    const withoutField=await deletePdfExistingFormField(bytes,'case.owner');
    const reloaded=await PDFDocument.load(withoutField);
    expect(reloaded.getPageCount()).toBe(2);
    expect(reloaded.getForm().getFieldMaybe('case.owner')).toBeUndefined();
    const annots=reloaded.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
    expect(annots.size()).toBe(3); // only comment, reply and markup; no stale widget
    for(let i=0;i<annots.size();i++){
      const dict=reloaded.context.lookup(annots.get(i),PDFDict);
      expect(dict.get(PDFName.of('Subtype'))?.toString()).not.toBe('/Widget');
    }
    expect((await listPdfTopLevelBookmarks(withoutField))[0].title).toBe('Résumé');
    expect((await listPdfPageLabelRanges(withoutField))[0].style).toBe('r');
    expect((await listPdfReviewAnnotations(withoutField))).toHaveLength(3);

    const history=recordPdfHistory(createPdfHistory(bytes),withoutField,1,'Deleted form field');
    expect((await PDFDocument.load(undoPdfHistory(history).entry.bytes)).getForm()
      .getTextField('case.owner').getText()).toBe('Alice');
    expect((await PDFDocument.load(redoPdfHistory(undoPdfHistory(history).history).entry.bytes))
      .getForm().getFieldMaybe('case.owner')).toBeUndefined();
    expect((await PDFDocument.load(original)).getForm().getFields()).toEqual([]);
  });
});
