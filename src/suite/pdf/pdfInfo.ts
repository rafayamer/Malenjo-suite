import {PDFDocument,PDFName,PDFNumber} from 'pdf-lib';

export const PDF_INFO_MAX_INPUT_BYTES=512*1024*1024;
export const PDF_INFO_MAX_PAGES=2000;
export const PDF_INFO_MAX_METADATA_CHARS=4096;

export interface PdfDocumentInfo{
  schemaVersion:1;
  inspection:'local-pdf-lib';
  pageCount:number;
  pages:Array<{page:number;widthPt:number;heightPt:number;rotationDegrees:number}>;
  metadata:{
    title:string|null;author:string|null;subject:string|null;
    keywords:string|null;creator:string|null;producer:string|null;
    createdAt:string|null;modifiedAt:string|null;
  };
  warning:string;
}

function normalizeMeta(value:string|undefined):string|null{
  if(value===undefined)return null;
  if(value.length>PDF_INFO_MAX_METADATA_CHARS){
    throw new Error('PDF metadata exceeds the 4,096-character inspection limit.');
  }
  return value;
}

function dateOrNull(date:Date|undefined):string|null{
  if(!date)return null;
  if(Number.isNaN(date.getTime()))return null;
  return date.toISOString();
}

/**
 * Local metadata and page geometry inspection: this is read-only.
 * Does not claim to verify signatures, decrypt protected PDFs, diagnose
 * embedded malware, or reproduce Stirling's full GetPdfInfo response.
 */
export async function inspectPdfDocumentInfo(bytes:Uint8Array):Promise<PdfDocumentInfo>{
  if(!bytes.byteLength||bytes.byteLength>PDF_INFO_MAX_INPUT_BYTES){
    throw new Error('PDF information inspection requires a file up to 512 MB.');
  }
  // pdf-lib retains an independent parse context; no PDF bytes are rewritten.
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
  const count=pdf.getPageCount();
  if(count<1||count>PDF_INFO_MAX_PAGES){
    throw new Error('PDF information inspection supports 1–2,000 pages.');
  }
  const pages=pdf.getPages().map((page,index)=>{
    const {width,height}=page.getSize();
    const rawUnit=page.node.get(PDFName.of('UserUnit'));
    const parsedUnit=rawUnit?pdf.context.lookup(rawUnit):undefined;
    const factor=parsedUnit instanceof PDFNumber?parsedUnit.asNumber():1;
    if((rawUnit&&!(parsedUnit instanceof PDFNumber))||!Number.isFinite(factor)||factor<=0||factor>75000){
      throw new Error('PDF page '+(index+1)+' has invalid /UserUnit.');
    }
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0){
      throw new Error('PDF page '+(index+1)+' has invalid geometry.');
    }
    return {
      page:index+1,widthPt:width*factor,heightPt:height*factor,
      rotationDegrees:page.getRotation().angle,
    };
  });
  return {
    schemaVersion:1,inspection:'local-pdf-lib',
    pageCount:count,pages,
    metadata:{
      title:normalizeMeta(pdf.getTitle()),
      author:normalizeMeta(pdf.getAuthor()),
      subject:normalizeMeta(pdf.getSubject()),
      keywords:normalizeMeta(pdf.getKeywords()),
      creator:normalizeMeta(pdf.getCreator()),
      producer:normalizeMeta(pdf.getProducer()),
      createdAt:dateOrNull(pdf.getCreationDate()),
      modifiedAt:dateOrNull(pdf.getModificationDate()),
    },
    warning:'Structural metadata and page geometry only. Does not validate signatures, permissions, security, font fidelity or PDF/A conformity.',
  };
}
