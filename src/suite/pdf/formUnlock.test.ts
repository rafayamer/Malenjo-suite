import {describe,expect,it} from 'vitest';
import {PDFDict,PDFDocument,PDFName,PDFString} from 'pdf-lib';
import {unlockReadOnlyPdfFormFields,PDF_FORM_UNLOCK_MAX_INPUT_BYTES} from './formUnlock';

async function sample():Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([400,500]);
  const form=pdf.getForm();
  const text=form.createTextField('person.name');
  text.addToPage(page,{x:40,y:350,width:190,height:30});
  text.setText('Original preserved');
  text.enableReadOnly();text.enableRequired();
  const checkbox=form.createCheckBox('agree');
  checkbox.addToPage(page,{x:40,y:250,width:20,height:20});
  checkbox.check();checkbox.enableReadOnly();
  const editable=form.createTextField('free');
  editable.addToPage(page,{x:40,y:180,width:190,height:30});
  editable.setText('Stay editable');
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
describe('offline PDF AcroForm field unlock',()=>{
  it('clears read-only flags, keeps required flags, values, widgets and original unchanged',async()=>{
    const original=await sample(),snapshot=Uint8Array.from(original);
    const result=await unlockReadOnlyPdfFormFields(original);
    expect(result.unlockedFields).toEqual(['person.name','agree']);
    const pdf=await PDFDocument.load(result.bytes);
    const fields=pdf.getForm();
    expect(fields.getTextField('person.name').getText()).toBe('Original preserved');
    expect(fields.getTextField('person.name').isReadOnly()).toBe(false);
    expect(fields.getTextField('person.name').isRequired()).toBe(true);
    expect(fields.getCheckBox('agree').isChecked()).toBe(true);
    expect(fields.getCheckBox('agree').isReadOnly()).toBe(false);
    expect(fields.getTextField('free').getText()).toBe('Stay editable');
    expect(fields.getFields()).toHaveLength(3);
    expect(original).toEqual(snapshot);
    expect((await PDFDocument.load(original)).getForm().getTextField('person.name').isReadOnly()).toBe(true);
  });
  it('refuses already editable forms instead of silently rewriting the document',async()=>{
    const first=await unlockReadOnlyPdfFormFields(await sample());
    await expect(unlockReadOnlyPdfFormFields(first.bytes))
      .rejects.toThrow(/already editable/);
  });
  it('refuses forms with XFA to prevent destroying hybrid field data',async()=>{
    const pdf=await PDFDocument.load(await sample());
    const form=pdf.catalog.lookup(PDFName.of('AcroForm'),PDFDict);
    form.set(PDFName.of('XFA'),PDFString.of('external XFA'));
    await expect(unlockReadOnlyPdfFormFields(Uint8Array.from(await pdf.save())))
      .rejects.toThrow(/XFA/);
  });
  it('refuses document certification and permission dictionaries',async()=>{
    const pdf=await PDFDocument.load(await sample());
    const permissions=pdf.context.obj({DocMDP:pdf.context.obj({})});
    pdf.catalog.set(PDFName.of('Perms'),permissions);
    await expect(unlockReadOnlyPdfFormFields(Uint8Array.from(await pdf.save())))
      .rejects.toThrow(/certification/);
  });
  it('refuses invalid input and excessive size before parsing',async()=>{
    await expect(unlockReadOnlyPdfFormFields(new Uint8Array()))
      .rejects.toThrow(/32 MB/);
    await expect(unlockReadOnlyPdfFormFields(new Uint8Array(PDF_FORM_UNLOCK_MAX_INPUT_BYTES+1)))
      .rejects.toThrow(/32 MB/);
  });
  it('refuses documents without actual AcroForm fields',async()=>{
    const doc=await PDFDocument.create();
    doc.addPage([200,300]);
    await expect(unlockReadOnlyPdfFormFields(Uint8Array.from(await doc.save())))
      .rejects.toThrow(/no AcroForm fields/i);
  });
});
