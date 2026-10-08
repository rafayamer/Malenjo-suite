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
const MAX_INDIRECT_OBJECTS=100_000;
const MAX_ANNOTATION_SLOTS=10_000;
const TYPE=PDFName.of('Type');
const SIG=PDFName.of('Sig');
const BYTE_RANGE=PDFName.of('ByteRange');
const CONTENTS=PDFName.of('Contents');
const ANN=PDFName.of('Annots');

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

  function signatureEvidence(dict:PDFDict):boolean{
    // Do not assume every signed revision still has a reachable AcroForm
    // field. A detached signature dictionary with /ByteRange and /Contents
    // is sufficient evidence to refuse a loss-inducing full PDF rewrite.
    const rawType=dict.get(TYPE);
    const type=rawType?pdf.context.lookup(rawType):undefined;
    return (type===SIG&&(dict.has(BYTE_RANGE)||dict.has(CONTENTS)))||
      (dict.has(BYTE_RANGE)&&dict.has(CONTENTS));
  }

  function nonNull(value:ReturnType<PDFDict['get']>):boolean{
    return Boolean(value&&pdf.context.lookup(value)!==nullObject);
  }

  function visit(
    value:PDFRef|PDFDict,
    inheritedSig=false,
    inheritedValue?:ReturnType<PDFDict['get']>,
    depth=0,
  ):void{
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
    // Both /FT and /V may be inherited independently. An ancestor can
    // supply /V before a descendant introduces /FT /Sig.
    const effectiveValue=dict.has(VALUE)?dict.get(VALUE):inheritedValue;
    if(signature&&nonNull(effectiveValue))populatedSignatureCount++;
    const children=dict.lookupMaybe(KIDS,PDFArray);
    if(children){
      for(let i=0;i<children.size();i++){
        const child=children.get(i);
        if(!(child instanceof PDFRef)&&!(child instanceof PDFDict)){
          throw new Error('PDF signature form field tree has an unsupported child.');
        }
        visit(child,signature,effectiveValue,depth+1);
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

  // A signature can survive outside the formal field tree after damaged or
  // incremental edits. Scan indirect signature dictionaries and page widget
  // annotations as well, including direct /V dictionaries. Do not inspect
  // arbitrary serialized names, strings or signature contents.
  const objects=pdf.context.enumerateIndirectObjects();
  if(objects.length>MAX_INDIRECT_OBJECTS){
    throw new Error('PDF has too many indirect objects to rule out existing signatures safely.');
  }
  let detachedSignatureEvidence=false;
  for(const [,object] of objects){
    if(object instanceof PDFDict&&signatureEvidence(object)){
      detachedSignatureEvidence=true;
      break;
    }
  }
  if(!detachedSignatureEvidence){
    const pages=pdf.getPages();
    let annotationSlots=0;
    for(const page of pages){
      const annots=page.node.lookupMaybe(ANN,PDFArray);
      if(!annots)continue;
      annotationSlots+=annots.size();
      if(annotationSlots>MAX_ANNOTATION_SLOTS){
        throw new Error('PDF has too many annotation slots to rule out existing signatures safely.');
      }
      for(let i=0;i<annots.size();i++){
        const entry=annots.get(i);
        if(!entry)throw new Error('PDF annotation array contains a malformed entry.');
        const dict=pdf.context.lookup(entry);
        if(!(dict instanceof PDFDict))continue;
        const rawType=dict.get(FT);
        const isSig=Boolean(rawType&&pdf.context.lookup(rawType)===SIG);
        const value=dict.get(VALUE);
        const linked=value?pdf.context.lookup(value):undefined;
        if((isSig&&nonNull(value))||
           (linked instanceof PDFDict&&signatureEvidence(linked))){
          detachedSignatureEvidence=true;
          break;
        }
      }
      if(detachedSignatureEvidence)break;
    }
  }
  return {
    signatureFieldCount,
    populatedSignatureCount,
    certifiedDocument,
    mayRewrite:!certifiedDocument&&!populatedSignatureCount&&!detachedSignatureEvidence,
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
