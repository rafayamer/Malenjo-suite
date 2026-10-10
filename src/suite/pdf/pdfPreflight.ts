import {
  PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFRef,PDFString,
} from 'pdf-lib';

/**
 * Read-only, offline PDF structural inspection and inert JavaScript listing.
 *
 * Does NOT execute JavaScript, fetch URLs, authenticate signatures, perform
 * PDF/A conformance checks, or assert that a document is free from malware.
 */
export const PDF_PREFLIGHT_MAX_INPUT_BYTES=32*1024*1024;
export const PDF_PREFLIGHT_MAX_OBJECTS=20_000;
export const PDF_PREFLIGHT_MAX_SCRIPTS=100;
export const PDF_PREFLIGHT_MAX_SCRIPT_CHARS=64_000;
export interface PdfEmbeddedScript{
  sourceObject:string;
  kind:'text'|'stream-or-unsupported';
  text:string|null;
}
export interface PdfPreflightReport{
  schemaVersion:1;
  inspection:'local-pdf-lib-structural';
  pageCount:number;
  formFieldCount:number;
  pageAnnotationCount:number;
  objectCount:number;
  embeddedJavaScriptCount:number;
  scriptContentUnavailable:number;
  scripts:PdfEmbeddedScript[];
  warnings:string[];
}

function contentFromJs(value:unknown):{kind:PdfEmbeddedScript['kind'];text:string|null}{
  if(value instanceof PDFString||value instanceof PDFHexString){
    const text=value.decodeText();
    if(text.length>PDF_PREFLIGHT_MAX_SCRIPT_CHARS){
      throw new Error('PDF JavaScript entry exceeds the 64,000-character inspection limit.');
    }
    return {kind:'text',text};
  }
  // /JS can be a stream. Never reinterpret compressed or encoded PDF streams
  // as executable text or silently claim to have inspected their script.
  return {kind:'stream-or-unsupported',text:null};
}

export async function inspectPdfStructuralSafety(bytes:Uint8Array):Promise<PdfPreflightReport>{
  if(!(bytes instanceof Uint8Array)||bytes.length<5||
     bytes.length>PDF_PREFLIGHT_MAX_INPUT_BYTES){
    throw new Error('Offline PDF inspection accepts files up to 32 MB.');
  }
  const pdf=await PDFDocument.load(bytes,{
    ignoreEncryption:false,updateMetadata:false,
  });
  const pageCount=pdf.getPageCount();
  if(pageCount<1||pageCount>2000){
    throw new Error('PDF inspection supports 1–2,000 pages.');
  }
  const objects=pdf.context.enumerateIndirectObjects();
  if(objects.length>PDF_PREFLIGHT_MAX_OBJECTS){
    throw new Error('PDF exceeds the 20,000-object inspection budget.');
  }
  const scripts:PdfEmbeddedScript[]=[];
  const visited=new Set<object>();
  let traversed=0;
  let pageAnnotationCount=0;
  const stack:Array<{value:unknown;sourceObject:string;depth:number}>=[];
  for(const [ref,value] of objects){
    stack.push({value,sourceObject:ref.toString(),depth:0});
  }
  while(stack.length){
    const {value,sourceObject,depth}=stack.pop()!;
    if(value===null||typeof value!=='object'||value instanceof PDFRef)continue;
    if(visited.has(value))continue;
    visited.add(value);
    if(++traversed>100_000){
      throw new Error('PDF contains too many nested objects for safe inspection.');
    }
    if(depth>32){
      throw new Error('PDF structural graph exceeds the 32-level safety limit.');
    }
    if(value instanceof PDFDict){
      const js=value.get(PDFName.of('JS'));
      if(js!==undefined){
        if(scripts.length>=PDF_PREFLIGHT_MAX_SCRIPTS){
          throw new Error('PDF exceeds the 100-script inspection limit.');
        }
        // /JS may be indirect; resolve without recursively processing decoded data.
        const resolved=js instanceof PDFRef?pdf.context.lookup(js):js;
        scripts.push({sourceObject,...contentFromJs(resolved)});
      }
      for(const [,entry] of value.entries()){
        if(!(entry instanceof PDFRef)){
          stack.push({value:entry,sourceObject,depth:depth+1});
        }
      }
    }else if(value instanceof PDFArray){
      for(let i=0;i<value.size();i++){
        const entry=value.get(i);
        if(!(entry instanceof PDFRef)){
          stack.push({value:entry,sourceObject,depth:depth+1});
        }
      }
    }
  }
  for(const page of pdf.getPages()){
    const annots=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray);
    if(annots)pageAnnotationCount+=annots.size();
    if(pageAnnotationCount>50_000){
      throw new Error('PDF annotation count exceeds the 50,000-item safety limit.');
    }
  }
  const acroForm=pdf.catalog.lookupMaybe(PDFName.of('AcroForm'),PDFDict);
  if(acroForm?.has(PDFName.of('XFA'))){
    throw new Error('XFA/hybrid PDF requires a dedicated validator.');
  }
  const fields=acroForm?pdf.getForm().getFields():[];
  if(fields.length>5000){
    throw new Error('PDF form inventory exceeds the 5,000-field safety limit.');
  }
  const warnings=[
    'A successful parse checks basic PDF structure, not PDF/A, PDF/UA, or ISO conformance.',
    'This report does not cryptographically validate digital signatures or prove the PDF is safe from malicious content.',
  ];
  if(scripts.length){
    warnings.push('Embedded JavaScript was found and listed as inert text; it was not executed.');
  }
  if(scripts.some(s=>s.text===null)){
    warnings.push('One or more PDF JavaScript entries are streams or unsupported types; script content was not decoded.');
  }
  if(pdf.catalog.has(PDFName.of('Perms'))){
    warnings.push('Document permissions/certification dictionary is present; cryptographic validity was not checked.');
  }
  return {
    schemaVersion:1,inspection:'local-pdf-lib-structural',
    pageCount,formFieldCount:fields.length,pageAnnotationCount,
    objectCount:objects.length,embeddedJavaScriptCount:scripts.length,
    scriptContentUnavailable:scripts.filter(s=>s.text===null).length,
    scripts,warnings,
  };
}

export function serializePdfPreflightJson(
  report:PdfPreflightReport,includeScriptText=false,
):Uint8Array{
  const output={...report,scripts:report.scripts.map(entry=>({
    ...entry,text:includeScriptText?entry.text:null,
  }))};
  const bytes=new TextEncoder().encode(JSON.stringify(output,null,2)+'\n');
  if(bytes.length>2*1024*1024){
    throw new Error('PDF inspection report exceeds the 2 MB safety limit.');
  }
  return bytes;
}
