import {describe,expect,it} from 'vitest';
import {PDFArray,PDFDict,PDFDocument,PDFName} from 'pdf-lib';
import {deletePdfExistingFormField,updatePdfExistingFieldProperties} from './formManagement';

async function sample():Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([400,500]);
  const form=pdf.getForm();
  const first=form.createTextField('document.owner');
  first.setText('Preserved value');
  first.addToPage(page,{x:40,y:300,width:210,height:35});
  const second=form.createCheckBox('approved');
  second.addToPage(page,{x:40,y:200,width:20,height:20});
  second.check();
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

describe('existing PDF AcroForm field management',()=>{
  it('toggles required/read-only flags without destroying values or neighbors',async()=>{
    const original=await sample();
    const changed=await updatePdfExistingFieldProperties(original,{
      name:'document.owner',required:true,readOnly:true,
    });
    const pdf=await PDFDocument.load(changed);
    const field=pdf.getForm().getTextField('document.owner');
    expect(field.isRequired()).toBe(true);
    expect(field.isReadOnly()).toBe(true);
    expect(field.getText()).toBe('Preserved value');
    expect(pdf.getForm().getCheckBox('approved').isChecked()).toBe(true);
    expect((await PDFDocument.load(original)).getForm().getTextField('document.owner').isReadOnly()).toBe(false);
    const cleared=await updatePdfExistingFieldProperties(changed,{
      name:'document.owner',required:false,readOnly:false,
    });
    expect((await PDFDocument.load(cleared)).getForm().getTextField('document.owner').isReadOnly()).toBe(false);
  });

  it('deletes only the chosen field and its widget annotation',async()=>{
    const original=await sample();
    const before=await PDFDocument.load(original);
    const initial=before.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
    expect(initial.size()).toBe(2);
    const result=await deletePdfExistingFormField(original,'document.owner');
    const pdf=await PDFDocument.load(result);
    expect(pdf.getForm().getFieldMaybe('document.owner')).toBeUndefined();
    expect(pdf.getForm().getCheckBox('approved').isChecked()).toBe(true);
    const remaining=pdf.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
    expect(remaining.size()).toBe(1);
    expect((await PDFDocument.load(original)).getForm().getFields()).toHaveLength(2);
  });

  it('rejects missing fields and improper property types without modifying original',async()=>{
    const original=await sample();
    await expect(deletePdfExistingFormField(original,'missing')).rejects.toThrow(/no longer exists/i);
    await expect(updatePdfExistingFieldProperties(original,{
      name:'approved',required:true,readOnly:'bad' as never,
    })).rejects.toThrow(/explicitly selected/i);
    expect((await PDFDocument.load(original)).getForm().getFields()).toHaveLength(2);
  });

  it('refuses XFA/hybrid AcroForms',async()=>{
    const original=await sample();
    const pdf=await PDFDocument.load(original);
    const dict=pdf.catalog.lookup(PDFName.of('AcroForm'),PDFDict);
    dict.set(PDFName.of('XFA'),pdf.context.obj([]));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(deletePdfExistingFormField(bytes,'approved')).rejects.toThrow(/XFA/i);
    await expect(updatePdfExistingFieldProperties(bytes,{
      name:'approved',required:true,readOnly:false,
    })).rejects.toThrow(/XFA/i);
  });
});
