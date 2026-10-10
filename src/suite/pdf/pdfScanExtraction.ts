import {OPS,type PDFDocumentProxy} from 'pdfjs-dist';
import {unzipSync,zipSync} from 'fflate';
import {
  exportPdfPagesAsPngZip,PDF_PAGE_IMAGE_MAX_PAGES,type PdfPngExportOptions,
} from './pageImageExport';
import {validatePngRaster} from './pngIntegrity';

/**
 * Offline scan-page extraction. This is page-raster extraction, not extraction
 * of original compressed image XObjects or text-layer/deskew reconstruction.
 * Selects pages containing PDF image paint operators and no selectable text.
 * OCR-hidden-text scans are intentionally not guessed by this conservative
 * detector. The untouched source PDF remains in the workspace.
 */
export const PDF_SCAN_ARCHIVE_MAX_BYTES=32*1024*1024;
const imageOperations=new Set(
  ['paintImageXObject','paintImageXObjectRepeat','paintInlineImageXObject',
    'paintInlineImageXObjectGroup','paintJpegXObject','paintImageMaskXObject']
    .map(name=>(OPS as Record<string,number>)[name])
    .filter((id):id is number=>Number.isInteger(id)),
);

export async function findPdfScanPageNumbers(
  pdf:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:{signal?:AbortSignal}={},
):Promise<number[]>{
  if(!Number.isSafeInteger(pdf.numPages)||pdf.numPages<1||
     pdf.numPages>PDF_PAGE_IMAGE_MAX_PAGES){
    throw new Error('Scan extraction accepts 1 to 50 PDF pages.');
  }
  const matches:number[]=[];
  for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
    if(options.signal?.aborted){
      const e=new Error('Scan extraction cancelled.');e.name='AbortError';throw e;
    }
    const page=await pdf.getPage(pageNumber);
    const text=await page.getTextContent();
    if(text.items.some(item=>'str' in item&&Boolean(item.str.trim())))continue;
    const operators=await page.getOperatorList();
    if(operators.fnArray.length>500_000){
      throw new Error('PDF scan detection exceeds the 500,000-operator page limit.');
    }
    if(operators.fnArray.some(id=>imageOperations.has(id))){
      matches.push(pageNumber);
    }
  }
  if(!matches.length){
    throw new Error('No image-painted pages without selectable text were found. OCR-enabled scans may require the provider.');
  }
  return matches;
}

/** Export the detected source pages with ORIGINAL page numbers in filenames. */
export async function extractPdfImageScanPages(
  pdf:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:PdfPngExportOptions={},
):Promise<{archive:Uint8Array;originalPages:number[]}>{
  const originalPages=await findPdfScanPageNumbers(pdf,options);
  const ordered={
    numPages:originalPages.length,
    getPage:(number:number)=>{
      if(!Number.isSafeInteger(number)||number<1||number>originalPages.length){
        throw new Error('Invalid selected scan page index.');
      }
      return pdf.getPage(originalPages[number-1]);
    },
  };
  const pngZip=await exportPdfPagesAsPngZip(ordered,options);
  if(options.signal?.aborted){
    const error=new Error('Scan extraction cancelled.');error.name='AbortError';throw error;
  }
  if(pngZip.byteLength>PDF_SCAN_ARCHIVE_MAX_BYTES){
    throw new Error('Scanned pages exceed the 32 MB in-app ZIP export limit.');
  }
  const original=unzipSync(pngZip);
  const renamed:Record<string,Uint8Array>={};
  for(let index=0;index<originalPages.length;index++){
    const name='page-'+String(index+1).padStart(4,'0')+'.png';
    const bytes=original[name];
    if(!bytes||!validatePngRaster(bytes)){
      throw new Error('Scanned PDF page PNG is missing or invalid.');
    }
    renamed['scan-original-page-'+String(originalPages[index]).padStart(4,'0')+'.png']=bytes;
  }
  if(Object.keys(original).length!==originalPages.length){
    throw new Error('Scan page export unexpectedly contains extra ZIP members.');
  }
  const archive=zipSync(renamed,{level:0});
  if(archive.byteLength>PDF_SCAN_ARCHIVE_MAX_BYTES){
    throw new Error('Scanned pages exceed the 32 MB in-app ZIP export limit.');
  }
  return {archive,originalPages};
}
