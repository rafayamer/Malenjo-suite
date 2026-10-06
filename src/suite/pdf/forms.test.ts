import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  clearPdfForm,
  createPdfFormField,
  flattenPdfForm,
  listPdfFormFields,
  setPdfFormFieldFlags,
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

  it('creates interactive text checkbox dropdown and option-list fields',async()=>{
    let pdf=await PDFDocument.create();
    pdf.addPage([500,700]);
    let bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));

    bytes=await createPdfFormField(bytes,{type:'text',name:'created.text',pageNumber:1,x:.1,y:.8,width:.4,height:.05,required:true});
    bytes=await createPdfFormField(bytes,{type:'checkbox',name:'created.check',pageNumber:1,x:.1,y:.7,width:.04,height:.04});
    bytes=await createPdfFormField(bytes,{type:'dropdown',name:'created.drop',pageNumber:1,x:.1,y:.6,width:.4,height:.05,options:['One','Two']});
    bytes=await createPdfFormField(bytes,{type:'option-list',name:'created.list',pageNumber:1,x:.1,y:.4,width:.4,height:.15,options:['A','B']});

    const fields=await listPdfFormFields(bytes);
    expect(fields.find((field)=>field.name==='created.text')?.required).toBe(true);
    expect(fields.find((field)=>field.name==='created.check')?.type).toBe('checkbox');
    expect(fields.find((field)=>field.name==='created.drop')?.options).toEqual(['One','Two']);
    expect(fields.find((field)=>field.name==='created.list')?.type).toBe('option-list');
  });

  it('updates required and read-only field flags',async()=>{
    let bytes=await fixture();
    bytes=await setPdfFormFieldFlags(bytes,'student.name',{required:true,readOnly:true});
    const field=(await listPdfFormFields(bytes)).find((item)=>item.name==='student.name');
    expect(field?.required).toBe(true);
    expect(field?.readOnly).toBe(true);
    await expect(setPdfFormFieldValue(bytes,'student.name','blocked')).rejects.toThrow(/read-only/i);
  });

  it('rejects duplicate and out-of-bounds created fields',async()=>{
    let pdf=await PDFDocument.create();
    pdf.addPage([500,700]);
    let bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    bytes=await createPdfFormField(bytes,{type:'text',name:'duplicate',pageNumber:1,x:.1,y:.8,width:.4,height:.05});
    await expect(createPdfFormField(bytes,{type:'text',name:'duplicate',pageNumber:1,x:.1,y:.7,width:.4,height:.05})).rejects.toThrow(/already exists/i);
    await expect(createPdfFormField(bytes,{type:'text',name:'bad-bounds',pageNumber:1,x:.9,y:.9,width:.4,height:.2})).rejects.toThrow(/inside the page/i);
  });

});
