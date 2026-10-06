import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import {
  addPdfBatesNumbers, addPdfCheckBox, addPdfCommentAnnotation, addPdfDropdown, addPdfHeaderFooter,
  addPdfInternalPageLink, addPdfUriLink,
  addPdfOptionList, addPdfRadioGroup, addPdfRectangleOverlay, addPdfTextField, addPdfTextOverlay, appendPdf,
  attachFileToPdf, deletePdfPage, deletePdfPages, duplicatePdfPage, extractPdfPage, extractPdfPages,
  clearPdfPageLabels, flattenPdfForm, inspectPdfDocumentProperties, inspectPdfFormFields, insertBlankPdfPage,
  insertPdfAfter, listPdfFormFields, movePdfPage, setPdfDocumentProperties, setPdfPageLabels,
  rotatePdfPagePermanent, rotatePdfPagesPermanent, setPdfPageBox, splitPdfAtPage,
} from './editor';

async function sample(pages=3):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  for(let i=0;i<pages;i+=1)pdf.addPage([300+i,400+i]);
  return Uint8Array.from(await pdf.save());
}

async function count(bytes:Uint8Array):Promise<number>{
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('PDF mutation core',()=>{
  it('deletes while preserving at least one page',async()=>{
    const bytes=await sample(3);
    expect(await count(await deletePdfPage(bytes,2))).toBe(2);
    await expect(deletePdfPage(await sample(1),1)).rejects.toThrow(/at least one page/i);
  });

  it('duplicates, extracts, appends and inserts blank pages',async()=>{
    const bytes=await sample(2);
    expect(await count(await duplicatePdfPage(bytes,1))).toBe(3);
    expect(await count(await extractPdfPage(bytes,2))).toBe(1);
    expect(await count(await appendPdf(bytes,await sample(3)))).toBe(5);
    expect(await count(await insertBlankPdfPage(bytes,1))).toBe(3);
  });

  it('batch deletes, rotates and extracts selected pages',async()=>{
    const source=await sample(4);
    expect(await count(await deletePdfPages(source,[2,4]))).toBe(2);
    await expect(deletePdfPages(source,[1,2,3,4])).rejects.toThrow(/at least one page/i);

    const rotated=await rotatePdfPagesPermanent(source,[1,3]);
    const rotatedPdf=await PDFDocument.load(rotated);
    expect(rotatedPdf.getPage(0).getRotation().angle).toBe(90);
    expect(rotatedPdf.getPage(1).getRotation().angle).toBe(0);
    expect(rotatedPdf.getPage(2).getRotation().angle).toBe(90);

    const extracted=await extractPdfPages(source,[4,2]);
    const extractedPdf=await PDFDocument.load(extracted);
    expect(extractedPdf.getPageCount()).toBe(2);
    expect(extractedPdf.getPage(0).getSize().width).toBe(301);
    expect(extractedPdf.getPage(1).getSize().width).toBe(303);
  });

  it('inserts another PDF at the active location and splits at a page boundary',async()=>{
    const source=await sample(3);
    const inserted=await insertPdfAfter(source,await sample(2),1);
    const insertedPdf=await PDFDocument.load(inserted);
    expect(insertedPdf.getPageCount()).toBe(5);
    expect(insertedPdf.getPage(0).getSize().width).toBe(300);
    expect(insertedPdf.getPage(1).getSize().width).toBe(300);
    expect(insertedPdf.getPage(3).getSize().width).toBe(301);

    const [left,right]=await splitPdfAtPage(source,2);
    expect(await count(left)).toBe(2);
    expect(await count(right)).toBe(1);
    await expect(splitPdfAtPage(source,3)).rejects.toThrow(/before the last/i);
  });

  it('moves pages and permanently rotates a page',async()=>{
    const bytes=await sample(3);
    const moved=await movePdfPage(bytes,1,3);
    const movedPdf=await PDFDocument.load(moved);
    expect(movedPdf.getPage(2).getSize().width).toBe(300);

    const rotated=await rotatePdfPagePermanent(bytes,1);
    const rotatedPdf=await PDFDocument.load(rotated);
    expect(rotatedPdf.getPage(0).getRotation().angle).toBe(90);
  });
  it('adds permanent text and rectangle overlays without changing page count',async()=>{
    const bytes=await sample(2);
    const withText=await addPdfTextOverlay(bytes,{pageNumber:1,text:'MALENJO note',x:0.1,y:0.8,size:12});
    expect(await count(withText)).toBe(2);
    const withHighlight=await addPdfRectangleOverlay(withText,{pageNumber:1,x:0.1,y:0.7,width:0.3,height:0.08,mode:'highlight'});
    expect(await count(withHighlight)).toBe(2);
  });

  it('creates a real PDF text-comment annotation',async()=>{
    const bytes=await addPdfCommentAnnotation(await sample(1),{
      pageNumber:1,
      text:'Review this clause',
      author:'Student Reviewer',
      x:0.2,
      y:0.75,
    });
    const pdf=await PDFDocument.load(bytes);
    const annots=pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'),PDFArray);
    expect(annots).toBeDefined();
    expect(annots?.size()).toBe(1);
  });

  it('creates AcroForm fields and can flatten them',async()=>{
    let bytes=await addPdfTextField(await sample(1),{
      pageNumber:1,name:'student_name',x:0.1,y:0.75,width:0.5,height:0.08,defaultValue:'Rafay',
    });
    bytes=await addPdfCheckBox(bytes,{
      pageNumber:1,name:'approved',x:0.1,y:0.62,size:0.06,checked:true,
    });
    expect(await listPdfFormFields(bytes)).toEqual(['student_name','approved']);
    const flattened=await flattenPdfForm(bytes);
    expect(await listPdfFormFields(flattened)).toEqual([]);
  });

  it('creates radio, dropdown and option-list fields with flags and selections',async()=>{
    let bytes=await addPdfRadioGroup(await sample(1),{
      pageNumber:1,
      name:'decision',
      options:['Approve','Reject'],
      selected:'Approve',
      x:0.1,
      y:0.75,
      size:0.04,
      gap:0.09,
      required:true,
    });
    bytes=await addPdfDropdown(bytes,{
      pageNumber:1,
      name:'department',
      options:['Engineering','Finance','Legal'],
      selected:['Legal'],
      x:0.1,
      y:0.45,
      width:0.45,
      height:0.08,
      readOnly:true,
    });
    bytes=await addPdfOptionList(bytes,{
      pageNumber:1,
      name:'reviewers',
      options:['Alice','Bob','Carol'],
      selected:['Alice','Carol'],
      x:0.1,
      y:0.12,
      width:0.45,
      height:0.22,
      multiselect:true,
    });

    const info=await inspectPdfFormFields(bytes);
    expect(info.map((field)=>field.type)).toEqual(['radio','dropdown','list']);
    expect(info[0]).toMatchObject({name:'decision',required:true,selected:['Approve']});
    expect(info[1]).toMatchObject({name:'department',readOnly:true,selected:['Legal']});
    expect(info[2].selected).toEqual(['Alice','Carol']);
    expect(info[2].options).toEqual(['Alice','Bob','Carol']);
  });

  it('applies required/read-only flags to text and checkbox fields',async()=>{
    let bytes=await addPdfTextField(await sample(1),{
      pageNumber:1,name:'readonly_name',x:0.1,y:0.75,width:0.5,height:0.08,
      required:true,readOnly:true,
    });
    bytes=await addPdfCheckBox(bytes,{
      pageNumber:1,name:'must_accept',x:0.1,y:0.62,size:0.06,required:true,
    });
    const info=await inspectPdfFormFields(bytes);
    expect(info.find((field)=>field.name==='readonly_name')).toMatchObject({required:true,readOnly:true});
    expect(info.find((field)=>field.name==='must_accept')).toMatchObject({required:true,readOnly:false});
  });

  it('rejects invalid radio and choice field configurations',async()=>{
    const bytes=await sample(1);
    await expect(addPdfRadioGroup(bytes,{
      pageNumber:1,name:'radio',options:['only'],x:0.1,y:0.7,size:0.05,
    })).rejects.toThrow(/at least 2/i);
    await expect(addPdfDropdown(bytes,{
      pageNumber:1,name:'choice',options:['A'],x:0.9,y:0.1,width:0.2,height:0.1,
    })).rejects.toThrow(/inside the page/i);
  });

  it('embeds an attachment into the PDF name tree',async()=>{
    const bytes=await attachFileToPdf(await sample(1),{
      name:'notes.txt',
      bytes:new TextEncoder().encode('MALENJO attachment test'),
      mimeType:'text/plain',
      description:'Synthetic test attachment',
    });
    const pdf=await PDFDocument.load(bytes);
    const names=pdf.catalog.lookupMaybe(PDFName.of('Names'),PDFDict);
    const embedded=names?.lookupMaybe(PDFName.of('EmbeddedFiles'),PDFDict);
    expect(embedded).toBeDefined();
  });

  it('adds headers/footers and Bates numbers to valid PDFs',async()=>{
    const source=await sample(3);
    const headerFooter=await addPdfHeaderFooter(source,{
      pageNumbers:[1,3],
      header:'MALENJO {page}/{pages}',
      footer:'{date}',
      fontSize:9,
      margin:18,
    });
    expect(await count(headerFooter)).toBe(3);
    expect(headerFooter.byteLength).toBeGreaterThan(source.byteLength);

    const bates=await addPdfBatesNumbers(source,{
      pageNumbers:[2,3],
      prefix:'CASE-',
      startNumber:42,
      digits:5,
      position:'bottom-right',
    });
    expect(await count(bates)).toBe(3);
    expect(bates.byteLength).toBeGreaterThan(source.byteLength);
  });

  it('sets selected PDF page boxes using point margins',async()=>{
    const source=await sample(2);
    const boxed=await setPdfPageBox(source,{
      pageNumbers:[2],
      box:'crop',
      top:10,
      right:20,
      bottom:30,
      left:40,
    });
    const pdf=await PDFDocument.load(boxed);
    const first=pdf.getPage(0).getCropBox();
    const second=pdf.getPage(1).getCropBox();
    expect(first.width).toBe(300);
    expect(first.height).toBe(400);
    expect(second.x).toBe(40);
    expect(second.y).toBe(30);
    expect(second.width).toBe(241);
    expect(second.height).toBe(361);
  });

  it('rejects invalid numbering and page-box inputs',async()=>{
    const source=await sample(1);
    await expect(addPdfHeaderFooter(source,{header:'',footer:''})).rejects.toThrow(/header or footer/i);
    await expect(addPdfBatesNumbers(source,{digits:0})).rejects.toThrow(/digit count/i);
    await expect(setPdfPageBox(source,{box:'crop',top:0,right:200,bottom:0,left:200})).rejects.toThrow(/usable page area/i);
  });

  it('rejects unsafe form/comment/attachment inputs',async()=>{
    const bytes=await sample(1);
    await expect(addPdfCommentAnnotation(bytes,{pageNumber:1,text:'',x:0.2,y:0.2})).rejects.toThrow(/empty/i);
    await expect(addPdfTextField(bytes,{pageNumber:1,name:'x',x:0.9,y:0.1,width:0.2,height:0.1})).rejects.toThrow(/inside the page/i);
    await expect(attachFileToPdf(bytes,{name:'empty.bin',bytes:new Uint8Array()})).rejects.toThrow(/empty/i);
  });

  it('writes and clears PDF page-label number trees',async()=>{
    const source=await sample(4);
    const labeled=await setPdfPageLabels(source,[
      {startPage:1,style:'roman-lower',prefix:'Intro-',startNumber:1},
      {startPage:3,style:'decimal',prefix:'P-',startNumber:1},
    ]);
    const pdf=await PDFDocument.load(labeled);
    const labels=pdf.catalog.lookupMaybe(PDFName.of('PageLabels'),PDFDict);
    expect(labels).toBeDefined();
    const nums=labels?.lookupMaybe(PDFName.of('Nums'),PDFArray);
    expect(nums?.size()).toBe(4);

    const cleared=await clearPdfPageLabels(labeled);
    const clearedPdf=await PDFDocument.load(cleared);
    expect(clearedPdf.catalog.lookupMaybe(PDFName.of('PageLabels'),PDFDict)).toBeUndefined();
  });

  it('creates real external and internal PDF link annotations',async()=>{
    let bytes=await addPdfUriLink(await sample(3),{
      pageNumber:1,
      url:'https://example.com/reference',
      label:'Reference',
      x:0.1,y:0.8,width:0.35,height:0.07,
    });
    bytes=await addPdfInternalPageLink(bytes,{
      pageNumber:1,
      targetPageNumber:3,
      x:0.1,y:0.65,width:0.35,height:0.07,
    });
    const pdf=await PDFDocument.load(bytes);
    const annots=pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'),PDFArray);
    expect(annots?.size()).toBe(2);
  });

  it('round-trips standard PDF document properties',async()=>{
    const updated=await setPdfDocumentProperties(await sample(1),{
      title:'MALENJO Test',
      author:'Rafius Tech LLC',
      subject:'PDF completeness',
      keywords:['malenjo','student'],
      creator:'MALENJO Suite',
      producer:'MALENJO PDF Workspace',
      language:'en-US',
    });
    const properties=await inspectPdfDocumentProperties(updated);
    expect(properties).toMatchObject({
      title:'MALENJO Test',
      author:'Rafius Tech LLC',
      subject:'PDF completeness',
      creator:'MALENJO Suite',
      producer:'MALENJO PDF Workspace',
      language:'en-US',
    });
    expect(properties.keywords).toEqual(expect.arrayContaining(['malenjo','student']));
    expect(properties.modificationDate).not.toBe('');
  });

  it('rejects unsafe link and page-label inputs',async()=>{
    const source=await sample(2);
    await expect(addPdfUriLink(source,{
      pageNumber:1,url:'javascript:alert(1)',x:0.1,y:0.1,width:0.2,height:0.1,
    })).rejects.toThrow(/http, https or mailto/i);
    await expect(setPdfPageLabels(source,[
      {startPage:1,style:'decimal',startNumber:1},
      {startPage:1,style:'roman-upper',startNumber:1},
    ])).rejects.toThrow(/only one/i);
  });

  it('rejects overlay coordinates outside the page',async()=>{
    const bytes=await sample(1);
    await expect(addPdfRectangleOverlay(bytes,{pageNumber:1,x:0.9,y:0.1,width:0.2,height:0.2})).rejects.toThrow(/inside the page/i);
    await expect(addPdfTextOverlay(bytes,{pageNumber:1,text:'x',x:1.1,y:0.2,size:12})).rejects.toThrow(/between 0 and 1/i);
  });
});
