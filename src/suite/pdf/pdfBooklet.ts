import {PDFArray,PDFDocument,PDFName} from 'pdf-lib';

/** Offline left-to-right, saddle-stitch booklet imposition in two-page
 * spreads. Reorders vector page artwork without rasterizing the source.
 * Interactive PDFs are deliberately rejected rather than losing forms,
 * signatures, links, annotations or bookmarks when pages are embedded.
 */
export const PDF_BOOKLET_MAX_INPUT_BYTES=32*1024*1024;
export const PDF_BOOKLET_MAX_PAGES=200;
export const PDF_BOOKLET_MAX_OUTPUT_BYTES=128*1024*1024;
export interface BookletSpread{
  sheet:number;
  side:'front'|'back';
  left:number|null;
  right:number|null;
}
export function planPdfBooklet(pageCount:number):BookletSpread[]{
  if(!Number.isSafeInteger(pageCount)||pageCount<1||pageCount>PDF_BOOKLET_MAX_PAGES){
    throw new Error('Booklet imposition requires 1–200 PDF pages.');
  }
  const padded=Math.ceil(pageCount/4)*4;
  const answer:BookletSpread[]=[];
  const present=(n:number)=>n<=pageCount?n:null;
  for(let sheet=0;sheet<padded/4;sheet++){
    answer.push({sheet:sheet+1,side:'front',
      left:present(padded-2*sheet),
      right:present(1+2*sheet)});
    answer.push({sheet:sheet+1,side:'back',
      left:present(2+2*sheet),
      right:present(padded-1-2*sheet)});
  }
  return answer;
}
export async function imposePdfBooklet(source:Uint8Array):Promise<Uint8Array>{
  if(!(source instanceof Uint8Array)||source.length<5||
     source.length>PDF_BOOKLET_MAX_INPUT_BYTES){
    throw new Error('Booklet imposition accepts PDFs up to 32 MB.');
  }
  const doc=await PDFDocument.load(source,{ignoreEncryption:false,updateMetadata:false});
  const count=doc.getPageCount();
  const plan=planPdfBooklet(count);
  if(doc.catalog.has(PDFName.of('AcroForm'))||
     doc.catalog.has(PDFName.of('Perms'))||
     doc.catalog.has(PDFName.of('Outlines'))){
    throw new Error('Booklet conversion refuses forms, signatures, permissions and bookmarks that could be lost.');
  }
  const pages=doc.getPages();
  const dimensions=pages.map(page=>{
    const annotations=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray);
    if(annotations&&annotations.size()>0){
      throw new Error('Booklet conversion refuses pages with annotations, form widgets or links.');
    }
    if(page.getRotation().angle!==0){
      throw new Error('Booklet conversion refuses rotated source page boxes.');
    }
    const {width,height}=page.getSize();
    if(!Number.isFinite(width)||!Number.isFinite(height)||
       width<=0||height<=0||width>7200||height>14400){
      throw new Error('Booklet page dimensions are unsupported or exceed PDF safety bounds.');
    }
    return {width,height};
  });
  const halfWidth=Math.max(...dimensions.map(p=>p.width));
  const height=Math.max(...dimensions.map(p=>p.height));
  const output=await PDFDocument.create();
  output.setTitle('MALENJO booklet');
  output.setCreator('MALENJO offline booklet imposition');
  const artwork=await output.embedPdf(source);
  if(artwork.length!==count)throw new Error('Could not embed all booklet source pages.');
  for(const spread of plan){
    const sheet=output.addPage([2*halfWidth,height]);
    for(const [index,pageNumber] of [spread.left,spread.right].entries()){
      if(pageNumber===null)continue;
      const size=dimensions[pageNumber-1];
      const scale=Math.min(halfWidth/size.width,height/size.height);
      const width=size.width*scale,renderedHeight=size.height*scale;
      sheet.drawPage(artwork[pageNumber-1],{
        x:index*halfWidth+(halfWidth-width)/2,
        y:(height-renderedHeight)/2,
        width,height:renderedHeight,
      });
    }
  }
  const result=Uint8Array.from(await output.save());
  if(result.length>PDF_BOOKLET_MAX_OUTPUT_BYTES){
    throw new Error('Generated booklet exceeds the 128 MB output safety limit.');
  }
  const reopened=await PDFDocument.load(result,{ignoreEncryption:false,updateMetadata:false});
  if(reopened.getPageCount()!==plan.length){
    throw new Error('Booklet output did not reopen with all two-up spreads.');
  }
  return result;
}
