import { describe, expect, it } from 'vitest';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import {
  addPdfBatesNumbers, addPdfCheckBox, addPdfCommentAnnotation, addPdfDropdown, addPdfHeaderFooter,
  addPdfOptionList, addPdfRadioGroup, addPdfRectangleOverlay, addPdfTextField, addPdfTextOverlay, appendPdf,
  attachFileToPdf, clearPdfFormFields, deletePdfPage, deletePdfPages, duplicatePdfPage, exportPdfFormData, extractPdfPage, extractPdfPages,
  fillPdfFormFields, flattenPdfForm, importPdfFormData, inspectPdfFormFields, insertBlankPdfPage, insertPdfAfter, listPdfFormFields, movePdfPage,
  resetPdfFormFields, rotatePdfPagePermanent, rotatePdfPagesPermanent, setPdfPageBox, splitPdfAtPage,
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

  it('fills existing text, checkbox and choice fields while respecting read-only fields',async()=>{
    let bytes=await addPdfTextField(await sample(1),{
      pageNumber:1,name:'student_name',x:0.1,y:0.82,width:0.5,height:0.07,
      defaultValue:'Before',
    });
    bytes=await addPdfCheckBox(bytes,{
      pageNumber:1,name:'approved',x:0.1,y:0.7,size:0.05,
    });
    bytes=await addPdfRadioGroup(bytes,{
      pageNumber:1,name:'decision',options:['Approve','Reject'],selected:'Reject',
      x:0.1,y:0.58,size:0.04,gap:0.08,
    });
    bytes=await addPdfDropdown(bytes,{
      pageNumber:1,name:'department',options:['Engineering','Finance','Legal'],selected:['Engineering'],
      x:0.1,y:0.34,width:0.45,height:0.07,
    });
    bytes=await addPdfOptionList(bytes,{
      pageNumber:1,name:'reviewers',options:['Alice','Bob','Carol'],selected:['Bob'],
      x:0.55,y:0.18,width:0.35,height:0.24,multiselect:true,
    });

    const filled=await fillPdfFormFields(bytes,[
      {name:'student_name',value:'MALENJO Student'},
      {name:'approved',checked:true},
      {name:'decision',selected:['Approve']},
      {name:'department',selected:['Legal']},
      {name:'reviewers',selected:['Alice','Carol']},
    ]);
    const info=await inspectPdfFormFields(filled);
    expect(info.find((field)=>field.name==='student_name')).toMatchObject({value:'MALENJO Student'});
    expect(info.find((field)=>field.name==='approved')).toMatchObject({checked:true});
    expect(info.find((field)=>field.name==='decision')?.selected).toEqual(['Approve']);
    expect(info.find((field)=>field.name==='department')?.selected).toEqual(['Legal']);
    expect(info.find((field)=>field.name==='reviewers')?.selected).toEqual(['Alice','Carol']);

    const readOnly=await addPdfTextField(filled,{
      pageNumber:1,name:'locked',x:0.1,y:0.08,width:0.35,height:0.06,readOnly:true,
    });
    await expect(fillPdfFormFields(readOnly,[{name:'locked',value:'blocked'}]))
      .rejects.toThrow(/read-only/i);
  });

  it('preserves external field names/options and reports password, multiline and multiselect semantics',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();

    const spaced=form.createTextField(' external name ');
    spaced.addToPage(page,{x:30,y:620,width:220,height:28});

    const secret=form.createTextField('secret');
    secret.enablePassword();
    secret.setText('top secret');
    secret.addToPage(page,{x:30,y:570,width:220,height:28});

    const notes=form.createTextField('notes');
    notes.enableMultiline();
    notes.setText('line one\nline two');
    notes.addToPage(page,{x:30,y:480,width:220,height:70});

    const multi=form.createDropdown('multi_department');
    multi.addOptions(['Engineering','Finance','  Legal  ']);
    multi.enableMultiselect();
    multi.select(['Engineering','Finance']);
    multi.addToPage(page,{x:30,y:420,width:220,height:28});

    const singleList=form.createOptionList('single_reviewer');
    singleList.addOptions(['Alice','Bob']);
    singleList.select('Alice');
    singleList.addToPage(page,{x:280,y:480,width:160,height:90});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const info=await inspectPdfFormFields(bytes);
    expect(info.find((field)=>field.name==='secret')).toMatchObject({
      password:true,value:'',
    });
    expect(info.find((field)=>field.name==='notes')).toMatchObject({
      multiline:true,value:'line one\nline two',
    });
    expect(info.find((field)=>field.name==='multi_department')).toMatchObject({
      multiselect:true,selected:['Engineering','Finance'],
    });
    expect(info.find((field)=>field.name==='single_reviewer')).toMatchObject({
      multiselect:false,selected:['Alice'],
    });

    const filled=await fillPdfFormFields(bytes,[
      {name:' external name ',value:'Привет MALENJO'},
      {name:'multi_department',selected:['Engineering','  Legal  ']},
    ]);
    const filledInfo=await inspectPdfFormFields(filled);
    expect(filledInfo.find((field)=>field.name===' external name ')?.value).toBe('Привет MALENJO');
    expect(filledInfo.find((field)=>field.name==='multi_department')?.selected)
      .toEqual(['Engineering','  Legal  ']);

    await expect(fillPdfFormFields(bytes,[
      {name:'multi_department',selected:['Missing option']},
    ])).rejects.toThrow(/does not contain the selected option/i);

    await expect(fillPdfFormFields(bytes,[
      {name:'single_reviewer',selected:['Alice','Bob']},
    ])).rejects.toThrow(/accepts one selected option/i);
  });

  it('exports, clears, imports and resets safe form data without exposing passwords',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();

    const name=form.createTextField('name');
    name.setText('Current Name');
    name.addToPage(page,{x:30,y:620,width:220,height:28});
    name.acroField.dict.set(PDFName.of('DV'),PDFHexString.fromText('Default Name'));

    const approved=form.createCheckBox('approved');
    approved.check();
    approved.addToPage(page,{x:30,y:580,width:20,height:20});
    approved.acroField.dict.set(PDFName.of('DV'),PDFName.of('Off'));

    const decision=form.createRadioGroup('decision');
    decision.addOptionToPage('Approve',page,{x:30,y:540,width:20,height:20});
    decision.addOptionToPage('Reject',page,{x:30,y:500,width:20,height:20});
    decision.select('Approve');
    const exports=decision.acroField.getExportValues()??[];
    const onValues=decision.acroField.getOnValues();
    const rejectIndex=exports.findIndex((value)=>value.decodeText()==='Reject');
    expect(rejectIndex).toBeGreaterThanOrEqual(0);
    decision.acroField.dict.set(PDFName.of('DV'),onValues[rejectIndex]);

    const department=form.createDropdown('department');
    department.addOptions(['Engineering','Finance']);
    department.select('Finance');
    department.addToPage(page,{x:30,y:450,width:220,height:28});
    department.acroField.dict.set(PDFName.of('DV'),PDFHexString.fromText('Engineering'));

    const secret=form.createTextField('secret');
    secret.enablePassword();
    secret.setText('private-value');
    secret.addToPage(page,{x:30,y:400,width:220,height:28});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const exported=await exportPdfFormData(bytes);
    const payload=JSON.parse(exported) as {format:string;version:number;fields:Array<{name:string}>};
    expect(payload.format).toBe('malenjo-pdf-form-data');
    expect(payload.version).toBe(1);
    expect(payload.fields.map((field)=>field.name)).toEqual(['name','approved','decision','department']);

    const cleared=await clearPdfFormFields(bytes);
    const clearedInfo=await inspectPdfFormFields(cleared);
    expect(clearedInfo.find((field)=>field.name==='name')?.value).toBe('');
    expect(clearedInfo.find((field)=>field.name==='approved')?.checked).toBe(false);
    expect(clearedInfo.find((field)=>field.name==='decision')?.selected).toEqual([]);
    expect(clearedInfo.find((field)=>field.name==='department')?.selected).toEqual([]);

    const imported=await importPdfFormData(cleared,exported);
    const importedInfo=await inspectPdfFormFields(imported);
    expect(importedInfo.find((field)=>field.name==='name')?.value).toBe('Current Name');
    expect(importedInfo.find((field)=>field.name==='approved')?.checked).toBe(true);
    expect(importedInfo.find((field)=>field.name==='decision')?.selected).toEqual(['Approve']);
    expect(importedInfo.find((field)=>field.name==='department')?.selected).toEqual(['Finance']);

    const reset=await resetPdfFormFields(imported);
    const resetInfo=await inspectPdfFormFields(reset);
    expect(resetInfo.find((field)=>field.name==='name')?.value).toBe('Default Name');
    expect(resetInfo.find((field)=>field.name==='approved')?.checked).toBe(false);
    expect(resetInfo.find((field)=>field.name==='decision')?.selected).toEqual(['Reject']);
    expect(resetInfo.find((field)=>field.name==='department')?.selected).toEqual(['Engineering']);

    await expect(importPdfFormData(bytes,'{}')).rejects.toThrow(/supported MALENJO v1 schema/i);
  });

  it('does not export values that the importer would reject',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();
    const oversized=form.createTextField('oversized');
    oversized.setText('x'.repeat(10001));
    oversized.addToPage(page,{x:30,y:620,width:220,height:28});
    const secret=form.createTextField('secret_only');
    secret.enablePassword();
    secret.setText('private');
    secret.addToPage(page,{x:30,y:570,width:220,height:28});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(exportPdfFormData(bytes)).rejects.toThrow(/no safely exportable/i);
  });

  it('skips stale choice defaults without blocking valid field resets',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();

    const text=form.createTextField('resettable_text');
    text.setText('current');
    text.addToPage(page,{x:30,y:620,width:220,height:28});
    text.acroField.dict.set(PDFName.of('DV'),PDFHexString.fromText('default'));

    const dropdown=form.createDropdown('stale_default_choice');
    dropdown.addOptions(['A','B']);
    dropdown.select('B');
    dropdown.addToPage(page,{x:30,y:570,width:220,height:28});
    dropdown.acroField.dict.set(PDFName.of('DV'),PDFHexString.fromText('REMOVED'));

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const reset=await resetPdfFormFields(bytes);
    const info=await inspectPdfFormFields(reset);
    expect(info.find((field)=>field.name==='resettable_text')?.value).toBe('default');
    expect(info.find((field)=>field.name==='stale_default_choice')?.selected).toEqual(['B']);
  });

  it('isolates rich-text fields and reports combined password/multiline flags',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();

    const ordinary=form.createTextField('ordinary');
    ordinary.setText('editable');
    ordinary.addToPage(page,{x:30,y:620,width:220,height:28});

    const rich=form.createTextField('rich');
    rich.addToPage(page,{x:30,y:570,width:220,height:28});
    rich.enableRichFormatting();

    const secret=form.createTextField('secret_multiline');
    secret.enablePassword();
    secret.enableMultiline();
    secret.setText('masked\nreplacement');
    secret.addToPage(page,{x:30,y:500,width:220,height:55});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const info=await inspectPdfFormFields(bytes);
    expect(info.find((field)=>field.name==='ordinary')).toMatchObject({
      richText:false,value:'editable',
    });
    expect(info.find((field)=>field.name==='rich')).toMatchObject({
      richText:true,value:'',
    });
    expect(info.find((field)=>field.name==='secret_multiline')).toMatchObject({
      password:true,multiline:true,value:'',
    });
    await expect(fillPdfFormFields(bytes,[{name:'rich',value:'unsupported'}]))
      .rejects.toThrow(/unsupported rich text/i);
  });

  it('preserves labeled choice export values and accepts editable dropdown custom values',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();

    const labeled=form.createDropdown('department_code');
    labeled.acroField.setOptions([
      {value:PDFHexString.fromText('ENG'),display:PDFHexString.fromText('Engineering')},
      {value:PDFHexString.fromText('FIN'),display:PDFHexString.fromText('Finance')},
    ]);
    labeled.addToPage(page,{x:30,y:620,width:220,height:28});
    labeled.acroField.dict.set(PDFName.of('V'),PDFHexString.fromText('ENG'));

    const editable=form.createDropdown('custom_department');
    editable.addOptions(['Known']);
    editable.enableEditing();
    editable.select('Custom One');
    editable.addToPage(page,{x:30,y:570,width:220,height:28});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const initial=await inspectPdfFormFields(bytes);
    expect(initial.find((field)=>field.name==='department_code')).toMatchObject({
      selected:['ENG'],
      choiceOptions:[
        {value:'ENG',label:'Engineering'},
        {value:'FIN',label:'Finance'},
      ],
    });
    expect(initial.find((field)=>field.name==='custom_department')).toMatchObject({
      editable:true,selected:['Custom One'],
    });

    const filled=await fillPdfFormFields(bytes,[
      {name:'department_code',selected:['FIN']},
      {name:'custom_department',selected:['Unlisted Custom Value']},
    ]);
    const updated=await inspectPdfFormFields(filled);
    expect(updated.find((field)=>field.name==='department_code')?.selected).toEqual(['FIN']);
    expect(updated.find((field)=>field.name==='custom_department')?.selected)
      .toEqual(['Unlisted Custom Value']);
  });

  it('lets ordinary fields update when an unsupported rich-text widget has no appearance stream',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();

    const ordinary=form.createTextField('ordinary');
    ordinary.setText('before');
    ordinary.addToPage(page,{x:30,y:620,width:220,height:28});

    const rich=form.createTextField('rich_missing_ap');
    rich.addToPage(page,{x:30,y:570,width:220,height:28});
    rich.enableRichFormatting();
    const [richWidget]=rich.acroField.getWidgets();
    richWidget.dict.delete(PDFName.of('AP'));

    const bytes=Uint8Array.from(await pdf.save({
      useObjectStreams:false,
      updateFieldAppearances:false,
    }));
    const filled=await fillPdfFormFields(bytes,[{name:'ordinary',value:'after'}]);
    const info=await inspectPdfFormFields(filled);
    expect(info.find((field)=>field.name==='ordinary')?.value).toBe('after');
    expect(info.find((field)=>field.name==='rich_missing_ap')).toMatchObject({
      richText:true,
    });
  });

  it('defers untouched password widgets with missing appearances when another field changes',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();

    const ordinary=form.createTextField('ordinary_for_password');
    ordinary.setText('before');
    ordinary.addToPage(page,{x:30,y:620,width:220,height:28});

    const secret=form.createTextField('untouched_secret');
    secret.enablePassword();
    secret.setText('existing secret');
    secret.addToPage(page,{x:30,y:570,width:220,height:28});
    secret.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));

    const bytes=Uint8Array.from(await pdf.save({
      useObjectStreams:false,
      updateFieldAppearances:false,
    }));
    const filled=await fillPdfFormFields(bytes,[{
      name:'ordinary_for_password',
      value:'after',
    }]);

    const reloaded=await PDFDocument.load(filled,{updateMetadata:false});
    const reloadedForm=reloaded.getForm();
    expect(reloadedForm.getTextField('ordinary_for_password').getText()).toBe('after');
    expect(reloadedForm.getTextField('untouched_secret').acroField.getWidgets()[0].dict.has(PDFName.of('AP')))
      .toBe(false);
    expect(reloadedForm.acroForm.dict
      .lookupMaybe(PDFName.of('NeedAppearances'),PDFBool)
      ?.asBoolean()).toBe(true);
  });

  it('defers untouched labeled choice widgets with missing appearances when another field changes',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();

    const ordinary=form.createTextField('ordinary_for_choice');
    ordinary.setText('before');
    ordinary.addToPage(page,{x:30,y:620,width:220,height:28});

    const labeled=form.createDropdown('untouched_labeled_choice');
    labeled.acroField.setOptions([
      {value:PDFHexString.fromText('ENG'),display:PDFHexString.fromText('Engineering')},
      {value:PDFHexString.fromText('FIN'),display:PDFHexString.fromText('Finance')},
    ]);
    labeled.addToPage(page,{x:30,y:570,width:220,height:28});
    labeled.acroField.dict.set(PDFName.of('V'),PDFHexString.fromText('ENG'));
    labeled.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));

    const bytes=Uint8Array.from(await pdf.save({
      useObjectStreams:false,
      updateFieldAppearances:false,
    }));
    const filled=await fillPdfFormFields(bytes,[{
      name:'ordinary_for_choice',
      value:'after',
    }]);

    const reloaded=await PDFDocument.load(filled,{updateMetadata:false});
    const reloadedForm=reloaded.getForm();
    expect(reloadedForm.getTextField('ordinary_for_choice').getText()).toBe('after');
    expect(reloadedForm.getDropdown('untouched_labeled_choice').acroField.getWidgets()[0].dict.has(PDFName.of('AP')))
      .toBe(false);
    expect(reloadedForm.acroForm.dict
      .lookupMaybe(PDFName.of('NeedAppearances'),PDFBool)
      ?.asBoolean()).toBe(true);
  });

  it('detects and rejects ambiguous duplicate choice export values',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();
    const list=form.createOptionList('duplicate_exports');
    list.acroField.setOptions([
      {value:PDFHexString.fromText('DUP'),display:PDFHexString.fromText('First')},
      {value:PDFHexString.fromText('DUP'),display:PDFHexString.fromText('Second')},
      {value:PDFHexString.fromText('UNIQUE'),display:PDFHexString.fromText('Third')},
    ]);
    list.enableMultiselect();
    list.addToPage(page,{x:30,y:560,width:220,height:90});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const info=await inspectPdfFormFields(bytes);
    expect(info.find((field)=>field.name==='duplicate_exports')).toMatchObject({
      duplicateChoiceExports:true,
      multiselect:true,
    });
    await expect(fillPdfFormFields(bytes,[{
      name:'duplicate_exports',
      selected:['DUP'],
    }])).rejects.toThrow(/duplicate export values/i);
  });

  it('rejects hybrid XFA forms before AcroForm editing can discard XFA data',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();
    const field=form.createTextField('fallback');
    field.addToPage(page,{x:30,y:620,width:220,height:28});
    form.acroForm.dict.set(PDFName.of('XFA'),PDFHexString.fromText('<xfa/>'));

    const bytes=Uint8Array.from(await pdf.save({
      useObjectStreams:false,
      updateFieldAppearances:false,
    }));
    await expect(inspectPdfFormFields(bytes)).rejects.toThrow(/XFA\/hybrid/i);
    await expect(fillPdfFormFields(bytes,[{name:'fallback',value:'blocked'}]))
      .rejects.toThrow(/XFA\/hybrid/i);

    const reloaded=await PDFDocument.load(bytes,{updateMetadata:false});
    const acroForm=reloaded.catalog.lookup(PDFName.of('AcroForm'),PDFDict);
    expect(acroForm.has(PDFName.of('XFA'))).toBe(true);
  });

  it('preserves an empty-string radio export as a real selection',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();
    const radio=form.createRadioGroup('empty_export_radio');
    radio.addOptionToPage('',page,{x:30,y:620,width:20,height:20});
    radio.addOptionToPage('Other',page,{x:30,y:580,width:20,height:20});
    radio.select('');

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const info=await inspectPdfFormFields(bytes);
    expect(info.find((field)=>field.name==='empty_export_radio')).toMatchObject({
      type:'radio',
      selected:[''],
      duplicateChoiceExports:false,
    });

    const changed=await fillPdfFormFields(bytes,[{
      name:'empty_export_radio',
      selected:['Other'],
    }]);
    expect((await inspectPdfFormFields(changed))
      .find((field)=>field.name==='empty_export_radio')?.selected).toEqual(['Other']);
  });

  it('detects and rejects radio groups with duplicate export values',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();
    const radio=form.createRadioGroup('duplicate_radio_exports');
    radio.addOptionToPage('DUP',page,{x:30,y:620,width:20,height:20});
    radio.addOptionToPage('DUP',page,{x:30,y:580,width:20,height:20});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const info=await inspectPdfFormFields(bytes);
    expect(info.find((field)=>field.name==='duplicate_radio_exports')).toMatchObject({
      type:'radio',
      duplicateChoiceExports:true,
    });
    await expect(fillPdfFormFields(bytes,[{
      name:'duplicate_radio_exports',
      selected:['DUP'],
    }])).rejects.toThrow(/duplicate export values/i);
  });

  it('respects radio groups that cannot toggle back to off',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();
    const radio=form.createRadioGroup('decision_locked_on');
    radio.addOptionToPage('Approve',page,{x:30,y:620,width:20,height:20});
    radio.addOptionToPage('Reject',page,{x:30,y:580,width:20,height:20});
    radio.disableOffToggling();
    radio.select('Approve');

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const info=await inspectPdfFormFields(bytes);
    expect(info.find((field)=>field.name==='decision_locked_on')).toMatchObject({
      type:'radio',offToggleable:false,selected:['Approve'],
    });
    await expect(fillPdfFormFields(bytes,[{
      name:'decision_locked_on',
      selected:[],
    }])).rejects.toThrow(/cannot be cleared/i);

    const changed=await fillPdfFormFields(bytes,[{
      name:'decision_locked_on',
      selected:['Reject'],
    }]);
    expect((await inspectPdfFormFields(changed))
      .find((field)=>field.name==='decision_locked_on')?.selected).toEqual(['Reject']);
  });

  it('rejects editable multiselect dropdown writes instead of emitting invalid option indices',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();
    const dropdown=form.createDropdown('editable_multi');
    dropdown.addOptions(['Known A','Known B']);
    dropdown.enableEditing();
    dropdown.enableMultiselect();
    dropdown.select(['Known A','Known B']);
    dropdown.addToPage(page,{x:30,y:620,width:220,height:28});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const info=await inspectPdfFormFields(bytes);
    expect(info.find((field)=>field.name==='editable_multi')).toMatchObject({
      editable:true,multiselect:true,
    });
    await expect(fillPdfFormFields(bytes,[{
      name:'editable_multi',
      selected:['Custom A','Custom B'],
    }])).rejects.toThrow(/not safely writable/i);
  });

  it('defers password appearances so the replacement secret is not painted into the widget AP',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();
    const secret=form.createTextField('secret_update');
    secret.enablePassword();
    secret.addToPage(page,{x:30,y:620,width:220,height:28});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const before=await PDFDocument.load(bytes,{updateMetadata:false});
    const beforeField=before.getForm().getTextField('secret_update');
    const beforeAppearance=beforeField.acroField.getWidgets()[0].dict.get(PDFName.of('AP'))?.toString();

    const filled=await fillPdfFormFields(bytes,[{
      name:'secret_update',
      value:'ASCII secret replacement',
    }]);
    const after=await PDFDocument.load(filled,{updateMetadata:false});
    const afterForm=after.getForm();
    const afterField=afterForm.getTextField('secret_update');
    const afterAppearance=afterField.acroField.getWidgets()[0].dict.get(PDFName.of('AP'))?.toString();
    const needAppearances=afterForm.acroForm.dict
      .lookupMaybe(PDFName.of('NeedAppearances'),PDFBool)
      ?.asBoolean()??false;

    expect(afterField.getText()).toBe('ASCII secret replacement');
    expect(afterAppearance).toBe(beforeAppearance);
    expect(needAppearances).toBe(true);
    await expect(flattenPdfForm(filled)).rejects.toThrow(/reader-deferred form appearances/i);
  });

  it('preserves exact multiselect indices when distinct exports share a display label',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([500,700]);
    const form=pdf.getForm();
    const list=form.createOptionList('duplicate_labels');
    list.acroField.setOptions([
      {value:PDFHexString.fromText('A'),display:PDFHexString.fromText('Same label')},
      {value:PDFHexString.fromText('B'),display:PDFHexString.fromText('Same label')},
      {value:PDFHexString.fromText('C'),display:PDFHexString.fromText('Other')},
    ]);
    list.enableMultiselect();
    list.addToPage(page,{x:30,y:560,width:220,height:90});

    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const filled=await fillPdfFormFields(bytes,[{
      name:'duplicate_labels',
      selected:['A','B'],
    }]);
    const reloaded=await PDFDocument.load(filled,{updateMetadata:false});
    const reloadedList=reloaded.getForm().getOptionList('duplicate_labels');
    const indices=reloadedList.acroField.dict.lookup(PDFName.of('I'),PDFArray);

    expect(reloadedList.acroField.getValues().map((value)=>value.decodeText())).toEqual(['A','B']);
    expect(indices.lookup(0,PDFNumber).asNumber()).toBe(0);
    expect(indices.lookup(1,PDFNumber).asNumber()).toBe(1);
    await expect(flattenPdfForm(filled)).rejects.toThrow(/reader-deferred form appearances/i);
  });

  it('rejects oversized text instead of truncating the field value',async()=>{
    const bytes=await addPdfTextField(await sample(1),{
      pageNumber:1,name:'long_text',x:0.1,y:0.75,width:0.6,height:0.08,
      defaultValue:'keep me',
    });
    await expect(fillPdfFormFields(bytes,[{
      name:'long_text',
      value:'x'.repeat(10001),
    }])).rejects.toThrow(/10,000-character/i);
    const info=await inspectPdfFormFields(bytes);
    expect(info.find((field)=>field.name==='long_text')?.value).toBe('keep me');
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

  it('rejects overlay coordinates outside the page',async()=>{
    const bytes=await sample(1);
    await expect(addPdfRectangleOverlay(bytes,{pageNumber:1,x:0.9,y:0.1,width:0.2,height:0.2})).rejects.toThrow(/inside the page/i);
    await expect(addPdfTextOverlay(bytes,{pageNumber:1,text:'x',x:1.1,y:0.2,size:12})).rejects.toThrow(/between 0 and 1/i);
  });
});
