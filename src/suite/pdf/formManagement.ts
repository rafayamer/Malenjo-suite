import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRef,PDFSignature} from 'pdf-lib';

export interface PdfFormFieldPropertyUpdate {
  name:string;
  required:boolean;
  readOnly:boolean;
}

async function loadManagedForm(bytes:Uint8Array):Promise<PDFDocument>{
  if(!bytes.byteLength)throw new Error('PDF is empty.');
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
  const formDict=pdf.catalog.lookup(PDFName.of('AcroForm'));
  if(formDict instanceof PDFDict&&formDict.has(PDFName.of('XFA'))){
    throw new Error('XFA/hybrid PDF fields cannot be modified safely.');
  }
  return pdf;
}

function requireFieldName(name:string):void{
  if(typeof name!=='string'||!name.trim()||name.length>500||
      /[\u0000-\u001F\u007F-\u009F]/.test(name)){
    throw new Error('Choose an exact, valid PDF form field name.');
  }
}

/**
 * Modify flags of an existing AcroForm field without rewriting its value,
 * options, default appearance, coordinates, or neighboring fields.
 * This does not execute imported PDF validation/calculation JavaScript.
 */
export async function updatePdfExistingFieldProperties(
  bytes:Uint8Array,
  update:PdfFormFieldPropertyUpdate,
):Promise<Uint8Array>{
  requireFieldName(update.name);
  if(typeof update.required!=='boolean'||typeof update.readOnly!=='boolean'){
    throw new Error('Required/read-only properties must be explicitly selected.');
  }
  const pdf=await loadManagedForm(bytes);
  const form=pdf.getForm();
  const field=form.getFieldMaybe(update.name);
  if(!field)throw new Error('PDF form field "'+update.name+'" no longer exists.');
  if(field instanceof PDFSignature)throw new Error('Signature fields cannot be changed by form management.');
  if(update.required)field.enableRequired();else field.disableRequired();
  if(update.readOnly)field.enableReadOnly();else field.disableReadOnly();
  return Uint8Array.from(await pdf.save({useObjectStreams:false,updateFieldAppearances:false}));
}

/**
 * Delete only the explicitly selected existing AcroForm field and its widgets.
 * Refuse signatures and XFA. This is destructive only to the new working copy;
 * the workspace caller must apply the result through per-tab Undo/Redo.
 */
export async function deletePdfExistingFormField(
  bytes:Uint8Array,
  name:string,
):Promise<Uint8Array>{
  requireFieldName(name);
  const pdf=await loadManagedForm(bytes);
  const form=pdf.getForm();
  const field=form.getFieldMaybe(name);
  if(!field)throw new Error('PDF form field "'+name+'" no longer exists.');
  if(field instanceof PDFSignature)throw new Error('Signature fields cannot be removed by form management.');
  // pdf-lib removes the AcroForm field but some imported documents retain its
  // widget references in page /Annots. Capture exact refs BEFORE removal so
  // no neighbor's widgets or unrelated review annotations are affected.
  const targetRef=field.ref.toString();
  const annotsKey=PDFName.of('Annots');
  const subtypeKey=PDFName.of('Subtype');
  const parentKey=PDFName.of('Parent');
  for(const page of pdf.getPages()){
    const annots=page.node.lookupMaybe(annotsKey,PDFArray);
    if(!annots)continue;
    for(let index=annots.size()-1;index>=0;index--){
      const entry=annots.get(index);
      if(!(entry instanceof PDFRef))continue;
      let dict:PDFDict;
      try{dict=pdf.context.lookup(entry,PDFDict);}catch{continue;}
      const subtype=dict.get(subtypeKey);
      if(!(subtype instanceof PDFName)||subtype.toString()!=='/Widget')continue;
      const parent=dict.get(parentKey);
      const belongsToField=entry.toString()===targetRef ||
        (parent instanceof PDFRef && parent.toString()===targetRef);
      if(belongsToField)annots.remove(index);
    }
  }
  form.removeField(field);
  return Uint8Array.from(await pdf.save({useObjectStreams:false,updateFieldAppearances:false}));
}
