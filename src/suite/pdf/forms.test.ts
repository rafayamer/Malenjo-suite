import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  clearPdfForm,
  flattenPdfForm,
  listPdfFormFields,
  setPdfFormFieldValue,
} from './forms';

async function fixture():Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([500,700]);
  const form=pdf.getForm();

  const text=form.createTextField('student.name');
  text.setText('Initial');
  text.addToPage(page,{x:40,y:620,width:220,height:28});

  const check=form.createCheckBox('terms.accepted');
  check.addToPage(page,{x:40,y:570,width:18,height:18});

  const radio=form.createRadioGroup('choice.level');
  radio.addOptionToPage('A',page,{x:40,y:520,width:18,height:18});
  radio.addOptionToPage('B',page,{x:80,y:520,width:18,height:18});

  const dropdown=form.createDropdown('country');
  dropdown.addOptions(['Pakistan','United States','United Kingdom']);
  dropdown.select('Pakistan');
  dropdown.addToPage(page,{x:40,y:460,width:220,height:28});

  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

describe('Acrobat-class PDF forms foundation',()=>{
  it('discovers supported form field types and values',async()=>{
    const bytes=await fixture();
    const fields=await listPdfFormFields(bytes);
    expect(fields.map((field)=>field.name)).toEqual(expect.arrayContaining([
      'student.name','terms.accepted','choice.level','country',
    ]));
    expect(fields.find((field)=>field.name==='student.name')?.value).toBe('Initial');
    expect(fields.find((field)=>field.name==='country')?.options).toContain('Pakistan');
  });

  it('fills text checkbox radio and dropdown fields',async()=>{
    let bytes=await fixture();
    bytes=await setPdfFormFieldValue(bytes,'student.name','Rafay');
    bytes=await setPdfFormFieldValue(bytes,'terms.accepted',true);
    bytes=await setPdfFormFieldValue(bytes,'choice.level','B');
    bytes=await setPdfFormFieldValue(bytes,'country','United Kingdom');

    const fields=await listPdfFormFields(bytes);
    expect(fields.find((field)=>field.name==='student.name')?.value).toBe('Rafay');
    expect(fields.find((field)=>field.name==='terms.accepted')?.value).toBe(true);
    expect(fields.find((field)=>field.name==='choice.level')?.value).toBe('B');
    expect(fields.find((field)=>field.name==='country')?.value).toEqual(['United Kingdom']);
  });

  it('clears editable form values',async()=>{
    let bytes=await fixture();
    bytes=await setPdfFormFieldValue(bytes,'terms.accepted',true);
    bytes=await setPdfFormFieldValue(bytes,'choice.level','A');
    bytes=await clearPdfForm(bytes);
    const fields=await listPdfFormFields(bytes);
    expect(fields.find((field)=>field.name==='student.name')?.value).toBe('');
    expect(fields.find((field)=>field.name==='terms.accepted')?.value).toBe(false);
    expect(fields.find((field)=>field.name==='choice.level')?.value).toBe('');
    expect(fields.find((field)=>field.name==='country')?.value).toEqual([]);
  });

  it('flattens fields into page content and removes interactive fields',async()=>{
    const flattened=await flattenPdfForm(await fixture());
    expect(await listPdfFormFields(flattened)).toEqual([]);
  });

  it('rejects invalid option values',async()=>{
    await expect(setPdfFormFieldValue(await fixture(),'country','Atlantis')).rejects.toThrow(/not valid/i);
  });
});
