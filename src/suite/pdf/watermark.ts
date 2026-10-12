import {
  PDFDict, PDFDocument, PDFName, PDFSignature, StandardFonts, degrees, rgb,
} from 'pdf-lib';

export type PdfWatermarkPosition =
  | 'center'|'top-left'|'top-right'|'bottom-left'|'bottom-right';

export interface PdfTextWatermarkOptions {
  text:string;
  position:PdfWatermarkPosition;
  opacity:number;
  size:number;
  angle:number;
  pageNumbers?:readonly number[];
}

const MAX_WATERMARK_BYTES=32*1024*1024;
const MAX_WATERMARK_PAGES=300;

function checkSafeToModify(pdf:PDFDocument):void {
  if(pdf.catalog.has(PDFName.of('Perms'))){
    throw new Error('Certified or permission-protected PDFs cannot be watermarked safely.');
  }
  const form=pdf.catalog.lookupMaybe(PDFName.of('AcroForm'),PDFDict);
  if(form?.has(PDFName.of('XFA'))){
    throw new Error('XFA PDF watermark fidelity is not verified.');
  }
  if(pdf.getForm().getFields().some(field=>field instanceof PDFSignature)){
    throw new Error('PDF signature fields may be invalidated by watermarking.');
  }
  const objects=pdf.context.enumerateIndirectObjects();
  if(objects.length>20000)throw new Error('PDF object count exceeds safe watermark inspection bounds.');
  for(const [,obj] of objects){
    if(!(obj instanceof PDFDict))continue;
    if(obj.has(PDFName.of('ByteRange')) ||
      obj.get(PDFName.of('Type'))?.toString()==='/Sig'){
      throw new Error('Cryptographically signed PDFs cannot be watermarked safely.');
    }
  }
}

export async function applyPdfTextWatermark(
  input:Uint8Array, options:PdfTextWatermarkOptions,
):Promise<Uint8Array>{
  if(!(input instanceof Uint8Array)||input.length<8||input.length>MAX_WATERMARK_BYTES){
    throw new Error('Watermark input must be a PDF between 8 bytes and 32 MB.');
  }
  if(typeof options.text!=='string'||!options.text.trim()||
    options.text.length>80||/[\u0000-\u001f\u007f]/.test(options.text)){
    throw new Error('Watermark text must contain 1–80 printable characters.');
  }
  const {size,opacity,angle}=options;
  if(!Number.isFinite(size)||size<8||size>90||
    !Number.isFinite(opacity)||opacity<0.05||opacity>1||
    !Number.isFinite(angle)||angle< -75||angle>75){
    throw new Error('Watermark size, opacity or rotation exceeds supported limits.');
  }
  if(!['center','top-left','top-right','bottom-left','bottom-right'].includes(options.position)){
    throw new Error('Select a valid watermark position.');
  }

  const pdf=await PDFDocument.load(input,{
    ignoreEncryption:false,updateMetadata:false,
  });
  const count=pdf.getPageCount();
  if(!count||count>MAX_WATERMARK_PAGES){
    throw new Error('Watermarking supports 1 to 300 pages.');
  }
  checkSafeToModify(pdf);
  const pages=options.pageNumbers
    ? [...new Set(options.pageNumbers)] : Array.from({length:count},(_,i)=>i+1);
  if(!pages.length||pages.length>count||
    pages.some(page=>!Number.isInteger(page)||page<1||page>count)){
    throw new Error('Invalid watermark page selection; no partial output was saved.');
  }

  const font=await pdf.embedFont(StandardFonts.Helvetica);
  try{
    font.encodeText(options.text.trim());
  }catch{
    throw new Error('Selected watermark font cannot represent this text. Unicode font support is required.');
  }
  const margin=24;
  const width=font.widthOfTextAtSize(options.text.trim(),size);
  // Preflight all targeted pages before drawing anything, preventing partial output.
  for(const pageNumber of pages){
    const page=pdf.getPage(pageNumber-1);
    const {width:pageWidth,height:pageHeight}=page.getSize();
    if(page.getRotation().angle!==0||!Number.isFinite(pageWidth)||!Number.isFinite(pageHeight)||
      pageWidth<100||pageHeight<100||width>pageWidth-2*margin){
      throw new Error('Watermark cannot fit safely on a selected PDF page; unsupported rotation or page size.');
    }
  }

  for(const pageNumber of pages){
    const page=pdf.getPage(pageNumber-1);
    const {width:pageWidth,height:pageHeight}=page.getSize();
    const x=options.position==='center'?(pageWidth-width)/2:
      options.position.endsWith('left')?margin:pageWidth-margin-width;
    const y=options.position==='center'?(pageHeight-size)/2:
      options.position.startsWith('top')?pageHeight-margin-size:margin;
    page.drawText(options.text.trim(),{
      x,y,font,size,color:rgb(0.13,0.34,0.67),opacity,rotate:degrees(angle),
    });
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
