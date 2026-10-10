import {PDFDict,PDFDocument,PDFName} from 'pdf-lib';
import {
  PDF_INFO_MAX_INPUT_BYTES,PDF_INFO_MAX_METADATA_CHARS,PDF_INFO_MAX_PAGES,
} from './pdfInfo';

/** Only conventional Info-dictionary fields. This is not XMP/privacy removal. */
export interface PdfBasicMetadataUpdate{
  title:string;
  author:string;
  subject:string;
  keywords:string;
}

function requireField(label:string,value:string):void{
  if(typeof value!=='string'||value.length>PDF_INFO_MAX_METADATA_CHARS){
    throw new Error(label+' must contain at most 4,096 characters.');
  }
  if(value.includes('\u0000')){
    throw new Error(label+' contains an unsupported null character.');
  }
}

function hasSignatureDictionary(pdf:PDFDocument):boolean{
  const byteRange=PDFName.of('ByteRange');
  const fieldType=PDFName.of('FT');
  const type=PDFName.of('Type');
  // Real cryptographic signatures include a ByteRange dictionary. Rejecting
  // /Sig fields too protects unsigned placeholder fields from being rewritten.
  return pdf.context.enumerateIndirectObjects().some(([,object])=>
    object instanceof PDFDict&&(
      object.has(byteRange)||
      object.get(fieldType)?.toString()==='/Sig'||
      object.get(type)?.toString()==='/Sig'
    )
  );
}

/**
 * Mutates only standard PDF Info fields. Does not claim to remove hidden data,
 * rewrite XMP, sanitize embedded scripts, preserve digital signatures, or
 * reproduce every upstream Stirling metadata operation.
 */
export async function updatePdfBasicMetadata(
  source:Uint8Array,
  update:PdfBasicMetadataUpdate,
):Promise<Uint8Array>{
  if(source.byteLength<5||source.byteLength>PDF_INFO_MAX_INPUT_BYTES){
    throw new Error('PDF metadata editing requires a PDF of at most 512 MB.');
  }
  requireField('Title',update.title);
  requireField('Author',update.author);
  requireField('Subject',update.subject);
  requireField('Keywords',update.keywords);

  const pdf=await PDFDocument.load(source,{
    ignoreEncryption:false,updateMetadata:false,
  });
  const pages=pdf.getPageCount();
  if(pages<1||pages>PDF_INFO_MAX_PAGES){
    throw new Error('PDF metadata editing supports 1–2,000 pages.');
  }
  if(pdf.catalog.has(PDFName.of('Perms'))||hasSignatureDictionary(pdf)){
    throw new Error('PDF contains a signature field or byte range. Editing it here could invalidate a digital signature; use a signed-document workflow.');
  }

  const current={
    title:pdf.getTitle()??'',
    author:pdf.getAuthor()??'',
    subject:pdf.getSubject()??'',
    keywords:pdf.getKeywords()??'',
  };
  if(Object.entries(update).every(([key,value])=>
    current[key as keyof PdfBasicMetadataUpdate]===value
  )){
    throw new Error('No PDF metadata values were changed.');
  }

  pdf.setTitle(update.title);
  pdf.setAuthor(update.author);
  pdf.setSubject(update.subject);
  pdf.setKeywords(update.keywords.split(',').map(k=>k.trim()).filter(Boolean));
  pdf.setModificationDate(new Date());

  const output=Uint8Array.from(await pdf.save({useObjectStreams:false}));
  const reopened=await PDFDocument.load(output,{
    ignoreEncryption:false,updateMetadata:false,
  });
  if(reopened.getPageCount()!==pages||
    reopened.getTitle()!==update.title||
    reopened.getAuthor()!==update.author||
    reopened.getSubject()!==update.subject){
    throw new Error('PDF metadata output failed validation; no changes were applied.');
  }
  return output;
}
