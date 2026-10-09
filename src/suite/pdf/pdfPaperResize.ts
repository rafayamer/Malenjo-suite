import {PDFArray,PDFDict,PDFDocument,PDFName} from 'pdf-lib';

export const PDF_PAPER_SIZES={
  A4:[595.28,841.89],
  Letter:[612,792],
  Legal:[612,1008],
  A5:[419.53,595.28],
} as const;
export type PdfPaperSize=keyof typeof PDF_PAPER_SIZES;
export type PdfPaperOrientation='portrait'|'landscape';
export interface PdfResizeOptions{
  paper:PdfPaperSize;
  orientation:PdfPaperOrientation;
  marginPt:number;
}
const MAX_BYTES=512*1024*1024;
const MAX_PAGES=2000;
function equals(a:number,b:number):boolean{return Math.abs(a-b)<0.05;}
/**
 * Fit every *unannotated, unsigned, uncropped, unrotated* page onto a target
 * paper sheet, preserving graphics and text content streams with an affine
 * transform. PDFs with interactive content are rejected rather than silently
 * altering links, widget coordinates, signatures or page-box semantics.
 * This is layout transformation, NOT text reflow or OCR.
 */
export async function fitPdfToPaper(
  bytes:Uint8Array, options:PdfResizeOptions,
):Promise<Uint8Array>{
  if(!bytes.byteLength||bytes.byteLength>MAX_BYTES){
    throw new Error('Page resizing requires a PDF of at most 512 MB.');
  }
  const size=PDF_PAPER_SIZES[options.paper];
  if(!size||!['portrait','landscape'].includes(options.orientation)){
    throw new Error('Choose a supported paper size and orientation.');
  }
  if(!Number.isFinite(options.marginPt)||options.marginPt<0||options.marginPt>72){
    throw new Error('Margin must be between 0 and 72 points.');
  }
  const [width,height]=options.orientation==='landscape'?[size[1],size[0]]:[size[0],size[1]];
  if(width-2*options.marginPt<=0||height-2*options.marginPt<=0){
    throw new Error('Margins leave no usable page area.');
  }
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
  const count=pdf.getPageCount();
  if(count<1||count>MAX_PAGES)throw new Error('Page resizing supports 1 to 2,000 pages.');
  if(pdf.catalog.get(PDFName.of('Perms'))){
    throw new Error('PDF certification/usage rights restrict page resizing.');
  }
  const signature=PDFName.of('ByteRange'),field=PDFName.of('FT'),type=PDFName.of('Type');
  if(pdf.context.enumerateIndirectObjects().some(([,value])=>value instanceof PDFDict&&(
    value.has(signature)||value.get(field)?.toString()==='/Sig'||value.get(type)?.toString()==='/Sig'
  ))){
    throw new Error('PDF contains a signature dictionary. Resizing could invalidate the signature.');
  }
  if(pdf.catalog.get(PDFName.of('AcroForm'))){
    throw new Error('Page resizing refuses PDFs with form or signature dictionaries; use the provider after reviewing preservation requirements.');
  }
  // Validate all pages before changing any: no partially modified exports.
  for(const [index,page] of pdf.getPages().entries()){
    const box=page.getMediaBox();
    const crop=page.getCropBox(),trim=page.getTrimBox(),bleed=page.getBleedBox(),art=page.getArtBox();
    if(!Number.isFinite(box.width)||!Number.isFinite(box.height)||box.width<=0||box.height<=0){
      throw new Error('Page '+(index+1)+' has invalid dimensions.');
    }
    if(!equals(box.x,0)||!equals(box.y,0)||[crop,trim,bleed,art].some(b=>
      !equals(b.x,box.x)||!equals(b.y,box.y)||!equals(b.width,box.width)||!equals(b.height,box.height)
    )){
      throw new Error('Page '+(index+1)+' has custom page boxes. Resizing is refused to avoid accidental clipping.');
    }
    if(page.getRotation().angle%360!==0){
      throw new Error('Page '+(index+1)+' is rotated; normalize rotation before changing paper size.');
    }
    const annotations=page.node.get(PDFName.of('Annots'));
    if(annotations){
      const entries=pdf.context.lookup(annotations);
      // pdf-lib writes an empty /Annots array for ordinary pages. Empty is
      // safe; malformed arrays or any real annotation must still fail closed.
      if(!(entries instanceof PDFArray)||entries.size()>0){
        throw new Error('Page '+(index+1)+' contains annotations or links. Resizing is refused to preserve their geometry.');
      }
    }
  }
  for(const page of pdf.getPages()){
    const source=page.getSize();
    const scale=Math.min((width-2*options.marginPt)/source.width,(height-2*options.marginPt)/source.height);
    if(!Number.isFinite(scale)||scale<=0)throw new Error('PDF has invalid page scaling geometry.');
    const x=(width-source.width*scale)/2;
    const y=(height-source.height*scale)/2;
    page.scaleContent(scale,scale);
    page.translateContent(x,y);
    page.setSize(width,height);
  }
  const output=Uint8Array.from(await pdf.save({useObjectStreams:false}));
  if(output.byteLength>MAX_BYTES)throw new Error('Resized PDF exceeds the 512 MB safety limit.');
  const check=await PDFDocument.load(output,{ignoreEncryption:false,updateMetadata:false});
  if(check.getPageCount()!==count||check.getPages().some(page=>
    !equals(page.getWidth(),width)||!equals(page.getHeight(),height)
  )){
    throw new Error('Resized PDF could not be reopened with the expected page geometry.');
  }
  return output;
}
