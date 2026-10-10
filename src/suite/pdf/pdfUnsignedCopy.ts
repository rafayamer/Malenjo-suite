import {PDFDict,PDFDocument,PDFName} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {exportPdfRasterEffect} from './pdfRasterEffects';

/** Remove cryptographic signature structures only by creating a completely
 * NEW rasterized PDF; the original signed PDF stays untouched. This
 * intentionally INVALIDATES/REMOVES all signature evidence and does not
 * imply that a previously signed document is still verifiable or trusted.
 */
export const PDF_UNSIGNED_COPY_MAX_SOURCE_BYTES=32*1024*1024;
export const PDF_UNSIGNED_COPY_MAX_PAGES=20;
function signatureCount(pdf:PDFDocument):number{
  let count=pdf.catalog.has(PDFName.of('Perms'))?1:0;
  const ft=PDFName.of('FT'),type=PDFName.of('Type'),byteRange=PDFName.of('ByteRange');
  for(const [,value] of pdf.context.enumerateIndirectObjects()){
    if(value instanceof PDFDict&&(value.has(byteRange)||
       value.get(ft)?.toString()==='/Sig'||value.get(type)?.toString()==='/Sig'))count++;
  }
  return count;
}
export interface PdfUnsignedCopyOptions{
  signal?:AbortSignal;
  onProgress?:(done:number,total:number)=>void;
  /** Injected renderer used only in tests; production always rasterizes. */
  rasterize?:(pdf:Pick<PDFDocumentProxy,'numPages'|'getPage'>)=>Promise<Uint8Array>;
}
export async function createUnsignedRasterPdfCopy(
  source:Uint8Array,
  reader:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:PdfUnsignedCopyOptions={},
):Promise<{bytes:Uint8Array;invalidatedSignatureObjects:number}>{
  if(!(source instanceof Uint8Array)||source.length<5||
     source.length>PDF_UNSIGNED_COPY_MAX_SOURCE_BYTES){
    throw new Error('Unsigned raster copy supports PDFs of at most 32 MB.');
  }
  const input=await PDFDocument.load(source,{ignoreEncryption:false,updateMetadata:false});
  const count=input.getPageCount();
  if(count<1||count>PDF_UNSIGNED_COPY_MAX_PAGES||reader.numPages!==count){
    throw new Error('Unsigned copy supports 1 to 20 consistently decoded PDF pages.');
  }
  const signatures=signatureCount(input);
  if(!signatures){
    throw new Error('No certificate signature/certification structure was detected. A signature-removal copy is not needed.');
  }
  if(options.signal?.aborted){
    const error=new Error('Signature copy cancelled.');error.name='AbortError';throw error;
  }
  const bytes=await (options.rasterize
    ?options.rasterize(reader)
    :exportPdfRasterEffect(reader,{effect:'contrast',contrast:1,
      signal:options.signal,onProgress:options.onProgress}));
  if(bytes.length>32*1024*1024){
    throw new Error('Unsigned PDF copy exceeds the 32 MB output limit.');
  }
  const output=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
  if(output.getPageCount()!==count||signatureCount(output)>0){
    throw new Error('Unsigned output did not reopen safely without cryptographic signature objects.');
  }
  return {bytes,invalidatedSignatureObjects:signatures};
}
