import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';

export interface PdfSigningIntegrity {
  signatureFieldCount:number;
  populatedSignatureCount:number;
  certifiedDocument:boolean;
  mayRewrite:boolean;
}

const FORM=PDFName.of('AcroForm');
const FIELDS=PDFName.of('Fields');
const FT=PDFName.of('FT');
const KIDS=PDFName.of('Kids');
const VALUE=PDFName.of('V');
const PERMS=PDFName.of('Perms');
const MAX_FORM_NODES=4000;

/**
 * Conservative local structural inspection, not a cryptographic signature
 * validation. A populated /Sig field or document /Perms signature policy
 * blocks pdf-lib reserialization, which would invalidate signed revisions.
 */
export async function inspectPdfSigningIntegrity(bytes:Uint8Array):Promise<PdfSigningIntegrity>{
  if(!bytes.byteLength)throw new Error('PDF is empty.');
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
  const perms=pdf.catalog.lookupMaybe(PERMS,PDFDict);
  const certifiedDocument=Boolean(
    perms?.has(PDFName.of('DocMDP'))||
    perms?.has(PDFName.of('UR'))||
    perms?.has(PDFName.of('UR3'))
  );
  const form=pdf.catalog.lookupMaybe(FORM,PDFDict);
  const fields=form?.lookupMaybe(FIELDS,PDFArray);
  if(form&&!fields){
    throw new Error('PDF AcroForm field tree is malformed; signatures cannot be ruled out safely.');
  }
  // PDFNull is a pdf-lib singleton; no attacker-controlled stringification
  // is needed to distinguish an unfilled /V from a populated signature.
  const nullObject=pdf.context.obj(null);
  let signatureFieldCount=0;
  let populatedSignatureCount=0;
  let visitedCount=0;
  const seenRefs=new Set<string>();
  const seenDirect=new WeakSet<object>();

  function visit(value:PDFRef|PDFDict,inheritedSig=false,depth=0):void{
    if(++visitedCount>MAX_FORM_NODES||depth>32){
      throw new Error('PDF form field tree is too large or deeply nested to check signatures safely.');
    }
    if(value instanceof PDFRef){
      const key=value.toString();
      if(seenRefs.has(key))throw new Error('PDF signature form tree contains a duplicate or cycle.');
      seenRefs.add(key);
    }else{
      if(seenDirect.has(value))throw new Error('PDF signature form tree contains a cycle.');
      seenDirect.add(value);
    }
    const dict=pdf.context.lookup(value,PDFDict);
    // /FT and /V can both be indirect in imported PDFs. Resolve them
    // rather than comparing serialized PDF objects (or untrusted huge names).
    const rawType=dict.get(FT);
    const directSig=Boolean(rawType&&pdf.context.lookup(rawType)===PDFName.of('Sig'));
    const signature=inheritedSig||directSig;
    if(directSig)signatureFieldCount++;
    const signedValue=signature?dict.get(VALUE):undefined;
    if(signedValue&&pdf.context.lookup(signedValue)!==nullObject){
      populatedSignatureCount++;
    }
    const children=dict.lookupMaybe(KIDS,PDFArray);
    if(children){
      for(let i=0;i<children.size();i++){
        const child=children.get(i);
        if(!(child instanceof PDFRef)&&!(child instanceof PDFDict)){
          throw new Error('PDF signature form field tree has an unsupported child.');
        }
        visit(child,signature,depth+1);
      }
    }
  }

  if(fields){
    for(let i=0;i<fields.size();i++){
      const child=fields.get(i);
      if(!(child instanceof PDFRef)&&!(child instanceof PDFDict)){
        throw new Error('PDF signature field tree contains an unsupported entry.');
      }
      visit(child);
    }
  }
  return {
    signatureFieldCount,
    populatedSignatureCount,
    certifiedDocument,
    mayRewrite:!certifiedDocument&&!populatedSignatureCount,
  };
}

/** Only permit reserialization if no signed/certified revision was detected. */
export async function requirePdfUnsignedForMutation(bytes:Uint8Array):Promise<void>{
  const integrity=await inspectPdfSigningIntegrity(bytes);
  if(!integrity.mayRewrite){
    throw new Error(
      'This PDF contains digital-signature or certification evidence. '+
      'Editing and re-saving it would invalidate signatures. No changes were made. '+
      'Use MALENJO Sign to inspect the original, or work from an unsigned PDF.'
    );
  }
}
