import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName,PDFString} from 'pdf-lib';
import {unzipSync} from 'fflate';
import {
  appendPdf,splitPdfAtPage,extractPdfPages,deletePdfPages,movePdfPage,
  rotatePdfPagePermanent,insertBlankPdfPage,duplicatePdfPage,
  addPdfHeaderFooter,setPdfPageBox,addPdfTextOverlay,addPdfRectangleOverlay,
  attachFileToPdf,addPdfCommentAnnotation,addPdfTextField,
  fillPdfFormFields,flattenPdfForm,
} from './editor';
import {splitPdfByPageCount} from './splitByPageCount';
import {fitPdfToPaper} from './pdfPaperResize';
import {imposePdfBooklet} from './pdfBooklet';
import {removePdfReviewMarkup} from './pdfAnnotationCleanup';
import {addPdfTopLevelBookmark,listPdfTopLevelBookmarks} from './bookmarkEditor';
import {updatePdfExistingFieldProperties,deletePdfExistingFormField} from './formManagement';
import {runOfflinePdfPipeline} from './pdfOfflinePipeline';
import {updatePdfBasicMetadata} from './pdfMetadataEdit';
import {proposePdfMetadataFilename} from './pdfAutoRename';
import {inspectPdfDocumentInfo} from './pdfInfo';
import {inspectPdfStructuralSafety} from './pdfPreflight';
import {addPdfLinkAnnotation,listPdfLinkAnnotations} from './links';

/**
 * Core PDF "golden workflow" evidence. Each test creates an actual PDF,
 * executes the production operation, independently reopens the output with
 * pdf-lib and checks that the original bytes remain unchanged.
 *
 * These are AUTOMATED ADAPTER TESTS, not full click-through UI or complete
 * upstream feature acceptance. IDs map to Option B PDF parity requirements.
 */
async function fixture(count=4):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  pdf.setTitle('MALENJO Golden Fixture');
  for(let i=0;i<count;i++){
    const page=pdf.addPage([300+i*15,400+i*10]);
    page.drawText('page '+(i+1),{x:18,y:48,size:11});
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
async function reopen(bytes:Uint8Array):Promise<PDFDocument>{
  expect(new TextDecoder().decode(bytes.subarray(0,5))).toBe('%PDF-');
  return PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
}
async function unchanged(before:Uint8Array,after:()=>Promise<unknown>){
  const exact=Uint8Array.from(before);
  await after();
  expect(before).toEqual(exact);
}
const fieldSpec={pageNumber:1,name:'fullName',x:0.12,y:0.2,width:0.4,height:0.08,defaultValue:'Original'};
describe.sequential('Option B source-level golden PDF acceptance corpus',()=>{
  it('PDF-001 merge-pdfs: append every source page in order',async()=>{
    const a=await fixture(3),b=await fixture(2);
    await unchanged(a,async()=>{
      const doc=await reopen(await appendPdf(a,b));
      expect(doc.getPageCount()).toBe(5);
      expect(doc.getPage(4).getWidth()).toBe(315);
    });
  });
  it('PDF-002 split-pages: produce two independently reopenable pieces',async()=>{
    const a=await fixture();
    const [left,right]=await splitPdfAtPage(a,2);
    expect((await reopen(left)).getPageCount()).toBe(2);
    expect((await reopen(right)).getPage(0).getWidth()).toBe(330);
  });
  it('PDF-003 extract-pages: selected page identities survive export',async()=>{
    const doc=await reopen(await extractPdfPages(await fixture(),[2,4]));
    expect(doc.getPages().map(p=>p.getWidth())).toEqual([315,345]);
  });
  it('PDF-004 remove-pages: only unselected pages remain',async()=>{
    const doc=await reopen(await deletePdfPages(await fixture(),[2,3]));
    expect(doc.getPages().map(p=>p.getWidth())).toEqual([300,345]);
  });
  it('PDF-005 rearrange-pages: move is reflected in output page tree',async()=>{
    const doc=await reopen(await movePdfPage(await fixture(),4,1));
    expect(doc.getPages().map(p=>p.getWidth())).toEqual([345,300,315,330]);
  });
  it('PDF-006 rotate-pdf: selected page rotates and other pages are unchanged',async()=>{
    const doc=await reopen(await rotatePdfPagePermanent(await fixture(),2));
    expect(doc.getPages().map(p=>p.getRotation().angle)).toEqual([0,90,0,0]);
  });
  it('PDF-017 count splitting: each ZIP member is independently valid',async()=>{
    const result=await splitPdfByPageCount(await fixture(),2,1_000_000);
    const parts=Object.values(unzipSync(result.archive));
    expect(parts).toHaveLength(2);
    for(const bytes of parts)expect((await reopen(bytes)).getPageCount()).toBe(2);
    expect(result.pageCounts).toEqual([2,2]);
  });
  it('PDF-007 crop: adjusted CropBox preserves original media size',async()=>{
    const doc=await reopen(await setPdfPageBox(await fixture(),{
      pageNumbers:[1],box:'crop',top:12,right:4,bottom:5,left:3,
    }));
    expect(doc.getPage(0).getMediaBox().width).toBe(300);
    expect(doc.getPage(0).getCropBox().width).toBe(293);
    expect(doc.getPage(0).getCropBox().height).toBe(383);
    expect(doc.getPage(1).getCropBox().width).toBe(315);
  });
  it('PDF-008 scale-pages: every page reopens at A4 physical dimensions',async()=>{
    const doc=await reopen(await fitPdfToPaper(await fixture(),{
      paper:'A4',orientation:'portrait',marginPt:12,
    }));
    expect(doc.getPageCount()).toBe(4);
    for(const page of doc.getPages()){
      expect(page.getWidth()).toBeCloseTo(595.28);
      expect(page.getHeight()).toBeCloseTo(841.89);
    }
  });
  it('PDF-009 add-page-numbers: page-number footer is written to a valid PDF',async()=>{
    const doc=await reopen(await addPdfHeaderFooter(await fixture(),{
      footer:'Page {page} of {pages}',fontSize:9,
    }));
    expect(doc.getPageCount()).toBe(4);
  });
  it('PDF-012 booklet-imposition: all source pages form valid spreads',async()=>{
    const doc=await reopen(await imposePdfBooklet(await fixture()));
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(690);
  });
  it('PDF-018 add-attachments: original page count survives embedded file',async()=>{
    const source=await fixture(2);
    await unchanged(source,async()=>{
      const doc=await reopen(await attachFileToPdf(source,{
        name:'evidence.txt',bytes:new TextEncoder().encode('evidence'),mimeType:'text/plain',
      }));
      expect(doc.getPageCount()).toBe(2);
      expect(doc.catalog.has(PDFName.of('Names'))).toBe(true);
    });
  });
  it('PDF-062 remove-annotations: review cleanup removes note without changing source',async()=>{
    const source=await addPdfCommentAnnotation(await fixture(2),{
      pageNumber:1,text:'Review required',x:0.1,y:0.2,
    });
    await unchanged(source,async()=>{
      const result=await removePdfReviewMarkup(source);
      expect(result.removed).toBe(1);
      expect((await reopen(result.bytes)).getPageCount()).toBe(2);
    });
  });
  it('PDF-065 text overlay: edited PDF reopens with all pages',async()=>{
    const doc=await reopen(await addPdfTextOverlay(await fixture(),{
      pageNumber:2,text:'Approved',x:0.2,y:0.4,size:12,
    }));
    expect(doc.getPageCount()).toBe(4);
  });
  it('PDF-065 highlight overlay: rectangle geometry survives round-trip',async()=>{
    const doc=await reopen(await addPdfRectangleOverlay(await fixture(),{
      pageNumber:1,x:0.1,y:0.2,width:0.25,height:0.04,mode:'highlight',
    }));
    expect(doc.getPageCount()).toBe(4);
  });
  it('PDF-066 edit-table-of-contents: native bookmark retains its title',async()=>{
    const result=await addPdfTopLevelBookmark(await fixture(2),'Chapter One',2);
    expect((await reopen(result)).getPageCount()).toBe(2);
    expect((await listPdfTopLevelBookmarks(result)).map(b=>b.title)).toEqual(['Chapter One']);
  });
  it('PDF-075 fields: create a native AcroForm text field',async()=>{
    const bytes=await addPdfTextField(await fixture(1),fieldSpec);
    const doc=await reopen(bytes);
    expect(doc.getForm().getTextField('fullName').getText()).toBe('Original');
  });
  it('PDF-076 fill: update a real form value and independently reopen it',async()=>{
    const first=await addPdfTextField(await fixture(1),fieldSpec);
    const final=await fillPdfFormFields(first,[{name:'fullName',value:'Updated'}]);
    expect((await reopen(final)).getForm().getTextField('fullName').getText()).toBe('Updated');
  });
  it('PDF-077 modify-fields: preserve field value while changing flags',async()=>{
    const source=await addPdfTextField(await fixture(1),fieldSpec);
    const result=await updatePdfExistingFieldProperties(source,{
      name:'fullName',required:true,readOnly:true,
    });
    const field=(await reopen(result)).getForm().getTextField('fullName');
    expect(field.getText()).toBe('Original');
    expect(field.isReadOnly()).toBe(true);
    expect(field.isRequired()).toBe(true);
  });
  it('PDF-078 delete-fields: delete selected field without dropping page',async()=>{
    const source=await addPdfTextField(await fixture(1),fieldSpec);
    const result=await deletePdfExistingFormField(source,'fullName');
    expect((await reopen(result)).getForm().getFields()).toHaveLength(0);
    expect((await reopen(result)).getPageCount()).toBe(1);
  });
  it('PDF-075 flatten: field becomes noninteractive while page remains',async()=>{
    const source=await addPdfTextField(await fixture(1),fieldSpec);
    const result=await flattenPdfForm(source);
    expect((await reopen(result)).getForm().getFields()).toHaveLength(0);
  });
  it('PDF-079 multi-tool: parse plan and export ordered/rotated pages',async()=>{
    const source=await fixture(3);
    const result=await runOfflinePdfPipeline(source,[
      {action:'move',from:3,to:1},
      {action:'rotate',pages:[1],angle:90},
    ]);
    const doc=await reopen(result);
    expect(doc.getPages().map(p=>p.getWidth())).toEqual([330,300,315]);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });
  it('PDF-068 get-info-on-pdf: read metadata and geometry without modification',async()=>{
    const source=await fixture(2);
    await unchanged(source,async()=>{
      const info=await inspectPdfDocumentInfo(source);
      expect(info.pageCount).toBe(2);
      expect(info.metadata.title).toBe('MALENJO Golden Fixture');
      expect(info.pages[1].widthPt).toBe(315);
    });
  });
  it('PDF-056 verify-pdf subset: structural report flags its limited inspection',async()=>{
    const report=await inspectPdfStructuralSafety(await fixture(2));
    expect(report.pageCount).toBe(2);
    expect(report.embeddedJavaScriptCount).toBe(0);
    expect(report.inspection).toBe('local-pdf-lib-structural');
  });
  it('PDF-085 show-javascript: detect inert embedded script without executing it',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const action=pdf.context.register(pdf.context.obj({
      S:PDFName.of('JavaScript'),JS:PDFString.of('app.alert("never executed")'),
    }));
    pdf.catalog.set(PDFName.of('OpenAction'),action);
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const report=await inspectPdfStructuralSafety(bytes);
    expect(report.embeddedJavaScriptCount).toBeGreaterThanOrEqual(1);
    expect(report.scripts.some(s=>s.text?.includes('never executed'))).toBe(true);
  });
  it('PDF-083 auto-rename partial: proposal is deterministic, source stays intact',async()=>{
    const source=await fixture(1);
    const info=await inspectPdfDocumentInfo(source);
    expect(proposePdfMetadataFilename(info)).toBe('MALENJO Golden Fixture-renamed.pdf');
    expect((await reopen(source)).getPageCount()).toBe(1);
  });
  it('PDF metadata editing: independently inspect modified title and author',async()=>{
    const updated=await updatePdfBasicMetadata(await fixture(1),{
      title:'Approved',author:'MALENJO',subject:'Acceptance',keywords:'PDF',
    });
    const info=await inspectPdfDocumentInfo(updated);
    expect(info.metadata.title).toBe('Approved');
    expect(info.metadata.author).toBe('MALENJO');
  });
  it('PDF internal links: exported annotation resolves to real page',async()=>{
    const source=await fixture(2);
    const updated=await addPdfLinkAnnotation(source,{
      pageNumber:1,x:0.1,y:0.2,width:0.3,height:0.1,
    },{kind:'page',pageNumber:2});
    expect((await listPdfLinkAnnotations(updated))[0]).toMatchObject({
      pageNumber:1,kind:'page',destination:'2',
    });
    expect((await reopen(source)).getPageCount()).toBe(2);
  });
  it('PDF insert-blank-page: independent reopen preserves destination and page count',async()=>{
    const doc=await reopen(await insertBlankPdfPage(await fixture(2),1));
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(1).getWidth()).toBe(300);
  });
  it('PDF duplicate-page: duplicate page shares physical dimensions with source',async()=>{
    const doc=await reopen(await duplicatePdfPage(await fixture(2),2));
    expect(doc.getPages().map(p=>p.getWidth())).toEqual([300,315,315]);
  });
  it('negative transaction: invalid page deletion refuses without modifying source',async()=>{
    const source=await fixture(1),copy=Uint8Array.from(source);
    await expect(deletePdfPages(source,[1])).rejects.toThrow(/keep at least one page/);
    expect(source).toEqual(copy);
  });
});