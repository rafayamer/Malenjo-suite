import { PDFDocument } from 'pdf-lib';

export interface PdfImageSource {
  name: string;
  bytes: Uint8Array;
}
export interface PdfImageConversionOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}
export const PDF_IMAGE_MAX_COUNT = 100;
export const PDF_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
export const PDF_IMAGE_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const PDF_IMAGE_MAX_PIXELS = 25_000_000;

function checkCancelled(signal?:AbortSignal):void{
  if(!signal?.aborted)return;
  const error=new Error('Image-to-PDF conversion was cancelled.');
  error.name='AbortError';
  throw error;
}

function imageType(data:Uint8Array):'png'|'jpeg'{
  if(data.length>=24 && data[0]===0x89 && data[1]===0x50 && data[2]===0x4e &&
    data[3]===0x47 && data[4]===0x0d && data[5]===0x0a && data[6]===0x1a &&
    data[7]===0x0a && data[12]===0x49 && data[13]===0x48 &&
    data[14]===0x44 && data[15]===0x52){
    const dimensions=new DataView(data.buffer,data.byteOffset,data.byteLength);
    const width=dimensions.getUint32(16);
    const height=dimensions.getUint32(20);
    if(!width||!height||width*height>PDF_IMAGE_MAX_PIXELS){
      throw new Error('PNG dimensions exceed the 25-megapixel safety limit.');
    }
    return 'png';
  }
  if(data.length>=4 && data[0]===0xff && data[1]===0xd8 && data[2]===0xff){
    return 'jpeg';
  }
  throw new Error('Only valid PNG and JPEG images can be converted to PDF.');
}

/** Creates one PDF page per user-selected image, preserving exact selection order. */
export async function createPdfFromImages(
  images: PdfImageSource[],
  options: PdfImageConversionOptions={},
):Promise<Uint8Array>{
  if(!Array.isArray(images)||!images.length){
    throw new Error('Select at least one PNG or JPEG image.');
  }
  if(images.length>PDF_IMAGE_MAX_COUNT){
    throw new Error('Image-to-PDF conversion supports up to 100 images per document.');
  }
  let totalBytes=0;
  // Preflight every selected image BEFORE embedding the first one. No partial exports.
  const types: Array<'png'|'jpeg'>=[];
  for(const image of images){
    if(!image || !(image.bytes instanceof Uint8Array)){
      throw new Error('Invalid image input.');
    }
    if(!image.bytes.byteLength||image.bytes.byteLength>PDF_IMAGE_MAX_BYTES){
      throw new Error('Each selected image must be nonempty and no larger than 32 MB.');
    }
    totalBytes+=image.bytes.byteLength;
    if(totalBytes>PDF_IMAGE_MAX_TOTAL_BYTES){
      throw new Error('Selected images exceed the 128 MB combined safety limit.');
    }
    types.push(imageType(image.bytes));
  }

  checkCancelled(options.signal);
  const pdf=await PDFDocument.create();
  for(let i=0;i<images.length;i++){
    checkCancelled(options.signal);
    const bytes=images[i].bytes;
    const embedded=types[i]==='png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    checkCancelled(options.signal);
    if(!Number.isFinite(embedded.width)||!Number.isFinite(embedded.height)||
      embedded.width<1||embedded.height<1||embedded.width*embedded.height>PDF_IMAGE_MAX_PIXELS){
      throw new Error('Image dimensions exceed the 25-megapixel safety limit.');
    }
    const scale=Math.min(1,2000/embedded.width,2000/embedded.height);
    const width=embedded.width*scale, height=embedded.height*scale;
    const page=pdf.addPage([width,height]);
    page.drawImage(embedded,{x:0,y:0,width,height});
    options.onProgress?.(i+1,images.length);
  }
  checkCancelled(options.signal);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
