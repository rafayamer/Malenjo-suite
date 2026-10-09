import {PDFDict,PDFDocument,PDFName,PDFSignature,StandardFonts,rgb} from 'pdf-lib';

/**
 * Adds a clearly labeled visual name mark to a PDF working copy.
 * This is NOT a cryptographic PDF digital signature or legally verified
 * identity; it never claims a PKCS#7 signature or trusted timestamp.
 * Signed, encrypted, XFA and certified PDFs are rejected before mutation.
 */
export const PDF_VISUAL_SIGN_MAX_BYTES=32*1024*1024;
export interface PdfVisualSignature{
  name:string;
  pageNumber:number;
  x:number;y:number;
  fontSize?:number;
}
export async function addPdfVisualSignature(
  input:Uint8Array,mark:PdfVisualSignature,
):Promise<Uint8Array>{
  if(!(input instanceof Uint8Array)||input.length<5||
     input.length>PDF_VISUAL_SIGN_MAX_BYTES){
    throw new Error('Visual signature input must be a PDF of at most 32 MB.');
  }
  if(!Number.isInteger(mark.pageNumber)||mark.pageNumber<1||
     !Number.isFinite(mark.x)||mark.x<0||mark.x>1||
     !Number.isFinite(mark.y)||mark.y<0||mark.y>1){
    throw new Error('Visual signature requires a valid page and normalized location.');
  }
  if(typeof mark.name!=='string'||!mark.name.trim()||mark.name.length>80||
     /[\u0000-\u001f\u007f]/.test(mark.name)){
    throw new Error('Visual signature name must contain 1–80 printable characters.');
  }
  const fontSize=mark.fontSize??13;
  if(!Number.isFinite(fontSize)||fontSize<8||fontSize>24){
    throw new Error('Visual signature font must be between 8 and 24 points.');
  }
  const document=await PDFDocument.load(input,{
    ignoreEncryption:false,updateMetadata:false,
  });
  if(document.getPageCount()>2000||mark.pageNumber>document.getPageCount()){
    throw new Error('Visual signature page is outside the supported PDF page range.');
  }
  if(document.catalog.has(PDFName.of('Perms'))){
    throw new Error('Certified or permission-protected PDF cannot be visually modified.');
  }
  const acroForm=document.catalog.lookupMaybe(PDFName.of('AcroForm'),PDFDict);
  if(acroForm?.has(PDFName.of('XFA'))){
    throw new Error('XFA/hybrid PDF cannot be visually modified safely.');
  }
  if(acroForm?.get(PDFName.of('Fields')) &&
     document.getForm().getFields().some(field=>field instanceof PDFSignature)){
    throw new Error('PDF contains signature fields; altering it could invalidate signatures.');
  }
  const all=document.context.enumerateIndirectObjects();
  if(all.length>20_000)throw new Error('PDF exceeds the 20,000-object signature inspection limit.');
  for(const [,obj] of all){
    if(!(obj instanceof PDFDict))continue;
    if(obj.has(PDFName.of('ByteRange'))||
       obj.get(PDFName.of('Type'))?.toString()==='/Sig'||
       obj.get(PDFName.of('FT'))?.toString()==='/Sig'){
      throw new Error('PDF contains cryptographic signature data; visual signing would invalidate it.');
    }
  }
  const page=document.getPage(mark.pageNumber-1);
  if(page.getRotation().angle!==0){
    throw new Error('Visual signing of rotated pages requires orientation-aware placement.');
  }
  const {width,height}=page.getSize();
  const textName=Array.from(mark.name.trim()).map(char=>{
    const code=char.codePointAt(0)!;
    return code>=32&&code<=126?char:'?';
  }).join('');
  const font=await document.embedFont(StandardFonts.Helvetica);
  const bold=await document.embedFont(StandardFonts.HelveticaBold);
  const label='VISUAL MARK — NOT DIGITALLY SIGNED';
  const line='Signed visually by: '+textName;
  const boxWidth=Math.max(font.widthOfTextAtSize(line,fontSize)+20,260);
  const boxHeight=fontSize+35;
  const x=width*mark.x,y=height*mark.y;
  if(width<300||height<100||x+boxWidth>width-4||y+boxHeight>height-4){
    throw new Error('Visual signature would be outside this page; adjust the location.');
  }
  page.drawRectangle({x,y,width:boxWidth,height:boxHeight,
    borderColor:rgb(0.1,0.23,0.4),borderWidth:1,
    color:rgb(0.97,0.98,1),
  });
  page.drawText(line,{x:x+10,y:y+boxHeight-fontSize-8,
    font,size:fontSize,color:rgb(0.05,0.13,0.3),
  });
  // WinAnsi bundled fonts cannot represent U+2014; use ASCII hyphens.
  page.drawText(label.replace('—','-'),{
    x:x+10,y:y+9,font:bold,size:8,color:rgb(0.45,0.07,0.07),
  });
  const result=Uint8Array.from(await document.save({useObjectStreams:false}));
  if(result.length>PDF_VISUAL_SIGN_MAX_BYTES){
    throw new Error('Visually marked PDF exceeds the 32 MB output safety limit.');
  }
  const opened=await PDFDocument.load(result,{ignoreEncryption:false,updateMetadata:false});
  if(opened.getPageCount()!==document.getPageCount()){
    throw new Error('Visually marked PDF cannot be reopened with its original page count.');
  }
  return result;
}
