import {unzipSync} from 'fflate';
import {PDFDocument} from 'pdf-lib';
import {validatePngRaster} from './pngIntegrity';
import {jpegIsComplete} from './pdfTwentyWorkflows';

/** Image-only, offline CBZ comic -> PDF with deterministic natural page order.
 * Rejects malformed archives, ZIP-slip entries, excessive decompression,
 * unsupported image formats, and damaged raster files before saving.
 */
export const CBZ_TO_PDF_MAX_SOURCE_BYTES=32*1024*1024;
export const CBZ_TO_PDF_MAX_EXTRACTED_BYTES=128*1024*1024;
export const CBZ_TO_PDF_MAX_IMAGES=50;
export const CBZ_TO_PDF_MAX_PIXELS=16_000_000;
export const CBZ_TO_PDF_MAX_OUTPUT_BYTES=128*1024*1024;

export interface CbzPage{
  name:string;
  bytes:Uint8Array;
  type:'png'|'jpg';
}
const IMAGE_EXT=/\.(?:png|jpe?g)$/i;
export function readCbzPages(source:Uint8Array):CbzPage[]{
  if(source.length<22||source.length>CBZ_TO_PDF_MAX_SOURCE_BYTES){
    throw new Error('CBZ to PDF supports nonempty comic archives up to 32 MB.');
  }
  let total=0,count=0;
  let files:Record<string,Uint8Array>;
  try{
    files=unzipSync(source,{filter:(file)=>{
      const name=file.name;
      const parts=name.split('/');
      if(name.startsWith('/')||/[\\:\u0000-\u001f]/.test(name)||
         parts.some((part,index)=>part==='.'||part==='..'||
           (!part&&index<parts.length-1))){
        throw new Error('CBZ contains an unsafe member path.');
      }
      if(name.endsWith('/'))return false;
      if(!IMAGE_EXT.test(name)){
        throw new Error('CBZ contains an unsupported archive member.');
      }
      if(!file.originalSize||file.originalSize>12*1024*1024||
         file.originalSize>CBZ_TO_PDF_MAX_EXTRACTED_BYTES-total){
        throw new Error('CBZ image or decompression budget exceeded.');
      }
      total+=file.originalSize;
      if(++count>CBZ_TO_PDF_MAX_IMAGES){
        throw new Error('CBZ exceeds the 50-page image limit.');
      }
      return true;
    }});
  }catch(error){
    throw new Error('Invalid or unsafe CBZ archive: '+(error instanceof Error?error.message:String(error)));
  }
  const entries=Object.entries(files);
  if(!entries.length||entries.length!==count){
    throw new Error('CBZ has no valid page images or contains duplicate paths.');
  }
  entries.sort(([a],[b])=>a.localeCompare(b,'en',{numeric:true,sensitivity:'base'}));
  return entries.map(([name,bytes])=>{
    const png=/\.png$/i.test(name);
    if(png?!validatePngRaster(bytes):!jpegIsComplete(bytes)){
      throw new Error('CBZ page '+name+' contains an incomplete or damaged image.');
    }
    return {name,bytes,type:png?'png':'jpg'};
  });
}
export async function convertCbzToPdf(source:Uint8Array):Promise<Uint8Array>{
  const entries=readCbzPages(source);
  const doc=await PDFDocument.create();
  doc.setTitle('CBZ comic pages');
  doc.setCreator('MALENJO local CBZ to PDF');
  for(const entry of entries){
    let image;
    try{
      image=entry.type==='png'
        ?await doc.embedPng(entry.bytes)
        :await doc.embedJpg(entry.bytes);
    }catch{throw new Error('CBZ image could not be decoded for PDF embedding: '+entry.name);}
    if(!image.width||!image.height||image.width*image.height>CBZ_TO_PDF_MAX_PIXELS){
      throw new Error('CBZ image exceeds the 16-megapixel page safety limit.');
    }
    // Match source image aspect ratio while respecting PDF's 14,400 pt bound.
    const scale=Math.min(1,14400/image.width,14400/image.height);
    const width=image.width*scale,height=image.height*scale;
    const page=doc.addPage([width,height]);
    page.drawImage(image,{x:0,y:0,width,height});
  }
  const result=Uint8Array.from(await doc.save());
  if(result.length>CBZ_TO_PDF_MAX_OUTPUT_BYTES){
    throw new Error('Generated comic PDF exceeds the 128 MB safety limit.');
  }
  // Self-test that all image pages survive a real PDF-lib parse.
  const reopened=await PDFDocument.load(result,{updateMetadata:false});
  if(reopened.getPageCount()!==entries.length){
    throw new Error('Generated CBZ PDF cannot be reopened with all its pages.');
  }
  return result;
}
