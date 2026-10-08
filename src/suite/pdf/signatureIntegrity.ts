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
const PARENT=PDFName.of('Parent');
const MAX_PARENT_DEPTH=32;

/**
 * Structural PDF libraries normally expose only the latest xref definition.
 * Preserve older signed revisions as well: a prior incremental update may
 * contain /ByteRange and /Contents even after those objects were superseded.
 *
 * Inspect raw ASCII PDF name tokens without decoding or allocating strings
 * proportional to the document. Requiring a second EOF marker limits this
 * conservative check to files with multiple revision terminators.
 */
export function hasPriorPdfSignatureEvidence(bytes:Uint8Array):boolean{
  const isNameDelimiter=(byte:number|undefined):boolean=>
    byte===undefined||byte<=32||
    byte===40||byte===41||byte===60||byte===62||
    byte===91||byte===93||byte===47||byte===37;
  const hexDigit=(byte:number|undefined):number=>{
    if(byte===undefined)return -1;
    if(byte>=48&&byte<=57)return byte-48;
    if(byte>=65&&byte<=70)return byte-55;
    if(byte>=97&&byte<=102)return byte-87;
    return -1;
  };
  // PDF names can legally encode any character as # followed by two
  // hexadecimal digits. Compare decoded bytes in-place without stringifying
  // attacker-controlled names or allocating a decoded buffer.
  const nameEnd=(offset:number,token:string):number=>{
    if(bytes[offset]!==47)return -1;
    let i=offset+1;
    for(let n=1;n<token.length;n++){
      let decoded=bytes[i];
      if(decoded===35){
        const hi=hexDigit(bytes[i+1]);
        const lo=hexDigit(bytes[i+2]);
        if(hi<0||lo<0)return -1;
        decoded=(hi<<4)|lo;
        i+=3;
      }else i++;
      if(decoded!==token.charCodeAt(n))return -1;
    }
    return isNameDelimiter(bytes[i])?i:-1;
  };
  const hasNameValue=(at:number,token:string,start:number[]):boolean=>{
    const end=nameEnd(at,token);
    if(end<0)return false;
    let i=end;
    while(i<bytes.length&&bytes[i]<=32&&i<end+64)i++;
    return start.includes(bytes[i]);
  };
  let eofCount=0;
  let byteRange=false;
  let contents=false;
  let comment=false;
  let literalDepth=0;
  let escapedLiteral=false;
  for(let i=0;i<bytes.length;i++){
    const char=bytes[i];
    // A real EOF marker is normally on its own line, and is also a PDF comment.
    if(char===37&&(i===0||bytes[i-1]===10||bytes[i-1]===13)&&
       bytes[i+1]===37&&bytes[i+2]===69&&
       bytes[i+3]===79&&bytes[i+4]===70){
      eofCount++;
      // %%EOF is itself a comment. Evaluate before the comment handler
      // skips the final line of an incremental revision.
      if(eofCount>=2&&byteRange&&contents)return true;
    }
    if(comment){
      if(char===10||char===13)comment=false;
      continue;
    }
    if(literalDepth){
      // '%' is data inside PDF literal strings, even on the same line as
      // later signature keys. PDF strings may nest and escape parentheses.
      if(escapedLiteral){escapedLiteral=false;continue;}
      if(char===92){escapedLiteral=true;continue;}
      if(char===40)literalDepth++;
      if(char===41)literalDepth--;
      continue;
    }
    if(char===40){literalDepth=1;continue;}
    if(char===37){comment=true;continue;}
    if(char===47){
      if(!byteRange&&hasNameValue(i,'/ByteRange',[91]))byteRange=true;
      if(!contents&&hasNameValue(i,'/Contents',[60,40]))contents=true;
    }
    if(eofCount>=2&&byteRange&&contents)return true;
  }
  return false;
}

/**
 * Conservative local structural inspection, not a cryptographic signature
 * validation. A populated /Sig field or document /Perms signature policy
 * blocks pdf-lib reserialization, which would invalidate signed revisions.
 */
export async function inspectPdfSigningIntegrity(bytes:Uint8Array):Promise<PdfSigningIntegrity>{
  if(!bytes.byteLength)throw new Error('PDF is empty.');
  const priorRevisionSigned=hasPriorPdfSignatureEvidence(bytes);
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
    const directSig=Boolean(rawType&&pdf.context.lookup(rawType)===SIG);
    // PDF field inheritance is overridden by an explicitly supplied /FT.
    // An inherited /Sig must not classify a descendant /FT /Tx as signed.
    const signature=dict.has(FT)?directSig:inheritedSig;
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
    if(!(object instanceof PDFDict))continue;
    const rawType=object.get(FT);
    const sigField=Boolean(rawType&&pdf.context.lookup(rawType)===SIG);
    const rawValue=object.get(VALUE);
    const resolvedValue=rawValue?pdf.context.lookup(rawValue):undefined;
    if(signatureEvidence(object)||
       (sigField&&nonNull(rawValue))||
       (resolvedValue instanceof PDFDict&&signatureEvidence(resolvedValue))){
      detachedSignatureEvidence=true;
      break;
    }
  }
  // Orphaned widgets may omit both /FT and /V and inherit them through
  // one or more /Parent dictionaries. Resolve the nearest explicit value of
  // each independently; do not stop at /AcroForm/Fields or trust parent
  // references to be acyclic. All imported objects are kept inert.
  function orphanWidgetHasSignature(widget:PDFDict):boolean{
    let field:PDFDict=widget;
    let foundType=false;
    let isSignature=false;
    let foundValue=false;
    let inheritedValue:ReturnType<PDFDict['get']>;
    const seen=new WeakSet<PDFDict>();
    for(let depth=0;;depth++){
      if(depth>=MAX_PARENT_DEPTH||seen.has(field)){
        throw new Error('PDF widget parent tree contains a cycle or exceeds signature inspection limits.');
      }
      seen.add(field);
      if(!foundType&&field.has(FT)){
        foundType=true;
        const stored=field.get(FT);
        isSignature=Boolean(stored&&pdf.context.lookup(stored)===SIG);
      }
      if(!foundValue&&field.has(VALUE)){
        foundValue=true;
        inheritedValue=field.get(VALUE);
      }
      const parent=field.get(PARENT);
      if(!parent)break;
      const resolved=pdf.context.lookup(parent);
      if(!(resolved instanceof PDFDict)){
        throw new Error('PDF widget has a malformed parent; signatures cannot be ruled out.');
      }
      field=resolved;
    }
    if(isSignature&&nonNull(inheritedValue))return true;
    const linked=inheritedValue?pdf.context.lookup(inheritedValue):undefined;
    return linked instanceof PDFDict&&signatureEvidence(linked);
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
        if(orphanWidgetHasSignature(dict)){
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
    mayRewrite:!certifiedDocument&&!populatedSignatureCount&&!detachedSignatureEvidence&&!priorRevisionSigned,
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
