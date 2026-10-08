import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString,
} from 'pdf-lib';

export type PdfPageLabelStyle = 'D' | 'R' | 'r' | 'A' | 'a' | 'none';
export interface PdfPageLabelRange {
  startPage: number; // one-based physical PDF page number
  style: PdfPageLabelStyle;
  prefix: string;
  startNumber: number;
}

const PAGE_LABELS=PDFName.of('PageLabels');
const NUMS=PDFName.of('Nums');
const KIDS=PDFName.of('Kids');
const ALLOWED=new Set<PdfPageLabelStyle>(['D','R','r','A','a','none']);
export const PDF_PAGE_LABEL_MAX_RANGES=200;

async function load(bytes:Uint8Array):Promise<PDFDocument>{
  if(!bytes.byteLength)throw new Error('PDF is empty.');
  return PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
}
function parsePrefix(object:unknown):string{
  if(object===undefined)return '';
  if(object instanceof PDFString||object instanceof PDFHexString)return object.decodeText();
  throw new Error('Imported PDF page-label prefix has an unsupported encoding.');
}
function checkRange(range:PdfPageLabelRange,count:number):void{
  if(!Number.isSafeInteger(range.startPage)||range.startPage<1||range.startPage>count){
    throw new Error('Page label start page must refer to a page in this PDF.');
  }
  if(!ALLOWED.has(range.style))throw new Error('Unsupported PDF page-label numbering style.');
  if(!Number.isSafeInteger(range.startNumber)||range.startNumber<1||range.startNumber>1_000_000_000){
    throw new Error('Page label first number must be an integer from 1 to 1,000,000,000.');
  }
  if(typeof range.prefix!=='string'||range.prefix.length>80||
    /[\u0000-\u001F\u007F-\u009F]/.test(range.prefix)){
    throw new Error('Page label prefix must be 80 characters or shorter and contain no controls.');
  }
}
function styleFrom(dict:PDFDict):PdfPageLabelStyle{
  const value=dict.get(PDFName.of('S'));
  if(value===undefined)return 'none';
  if(!(value instanceof PDFName))throw new Error('Page label style must be a PDF name.');
  const style=value.asString().replace(/^\//,'') as PdfPageLabelStyle;
  if(!ALLOWED.has(style)||style==='none'){
    throw new Error('Imported PDF contains an unsupported page-label style.');
  }
  return style;
}
function existingRanges(pdf:PDFDocument):PdfPageLabelRange[]{
  const raw=pdf.catalog.get(PAGE_LABELS);
  if(!raw)return [];
  if(!(raw instanceof PDFRef)&&!(raw instanceof PDFDict)){
    throw new Error('Unsupported PDF PageLabels root; no labels were changed.');
  }
  const dict=pdf.catalog.lookup(PAGE_LABELS,PDFDict);
  if(dict.has(KIDS)){
    throw new Error('Nested PDF PageLabels number trees are read-only in this editor.');
  }
  const nums=dict.lookupMaybe(NUMS,PDFArray);
  if(!nums)return [];
  if(nums.size()%2||nums.size()/2>PDF_PAGE_LABEL_MAX_RANGES){
    throw new Error('Malformed or oversized PDF page-label number tree.');
  }
  const results:PdfPageLabelRange[]=[];
  let previous=-1;
  for(let i=0;i<nums.size();i+=2){
    const index=nums.lookup(i,PDFNumber).asNumber();
    const item=nums.lookup(i+1,PDFDict);
    if(!Number.isSafeInteger(index)||index<=previous||index>=pdf.getPageCount()){
      throw new Error('Imported PDF page-label ranges are not strictly ordered.');
    }
    const start=item.lookupMaybe(PDFName.of('St'),PDFNumber)?.asNumber()??1;
    const next:PdfPageLabelRange={
      startPage:index+1,
      style:styleFrom(item),
      prefix:parsePrefix(item.get(PDFName.of('P'))),
      startNumber:start,
    };
    checkRange(next,pdf.getPageCount());
    previous=index;
    results.push(next);
  }
  return results;
}

/** Lists simple /Nums ranges. Nested /Kids trees are explicitly unsupported. */
export async function listPdfPageLabelRanges(bytes:Uint8Array):Promise<PdfPageLabelRange[]>{
  return existingRanges(await load(bytes));
}

/** Upserts a real PDF PageLabels /Nums entry without dropping existing simple ranges. */
export async function setPdfPageLabelRange(
  bytes:Uint8Array,range:PdfPageLabelRange,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  checkRange(range,pdf.getPageCount());
  const existing=existingRanges(pdf).filter(item=>item.startPage!==range.startPage);
  existing.push(range);
  existing.sort((a,b)=>a.startPage-b.startPage);
  if(existing.length>PDF_PAGE_LABEL_MAX_RANGES){
    throw new Error('PDF page labels support at most 200 ranges.');
  }
  const nums:unknown[]=[];
  for(const item of existing){
    const attrs:Record<string,unknown>={St:PDFNumber.of(item.startNumber)};
    if(item.style!=='none')attrs.S=PDFName.of(item.style);
    if(item.prefix)attrs.P=PDFHexString.fromText(item.prefix);
    nums.push(PDFNumber.of(item.startPage-1),pdf.context.obj(attrs));
  }
  let root:PDFDict;
  const previous=pdf.catalog.get(PAGE_LABELS);
  if(previous){
    root=pdf.catalog.lookup(PAGE_LABELS,PDFDict);
  }else{
    root=pdf.context.obj({});
    pdf.catalog.set(PAGE_LABELS,pdf.context.register(root));
  }
  root.set(NUMS,pdf.context.obj(nums));
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function clearPdfPageLabelRanges(bytes:Uint8Array):Promise<Uint8Array>{
  const pdf=await load(bytes);
  // Validate before removing to avoid destroying imported nested PageLabels.
  existingRanges(pdf);
  pdf.catalog.delete(PAGE_LABELS);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
