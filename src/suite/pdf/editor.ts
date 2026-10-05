import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

function requirePage(pageNumber:number,pageCount:number):number{
  if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>pageCount){
    throw new Error(`Page ${pageNumber} is outside the PDF page range 1-${pageCount}.`);
  }
  return pageNumber-1;
}

async function load(bytes:Uint8Array):Promise<PDFDocument>{
  if(!bytes.length) throw new Error('PDF bytes are empty.');
  return PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
}

export async function deletePdfPage(bytes:Uint8Array,pageNumber:number):Promise<Uint8Array>{
  const pdf=await load(bytes);
  if(pdf.getPageCount()<=1) throw new Error('A PDF must keep at least one page.');
  pdf.removePage(requirePage(pageNumber,pdf.getPageCount()));
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function rotatePdfPagePermanent(bytes:Uint8Array,pageNumber:number):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(pageNumber,pdf.getPageCount()));
  const current=((page.getRotation().angle%360)+360)%360;
  page.setRotation(degrees((current+90)%360));
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function duplicatePdfPage(bytes:Uint8Array,pageNumber:number):Promise<Uint8Array>{
  const source=await load(bytes);
  const index=requirePage(pageNumber,source.getPageCount());
  const output=await PDFDocument.create();
  const order=Array.from({length:source.getPageCount()+1},(_,position)=>{
    if(position<=index)return position;
    if(position===index+1)return index;
    return position-1;
  });
  const copied=await output.copyPages(source,order);
  copied.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function movePdfPage(bytes:Uint8Array,pageNumber:number,targetPageNumber:number):Promise<Uint8Array>{
  const source=await load(bytes);
  const pageCount=source.getPageCount();
  const from=requirePage(pageNumber,pageCount);
  const to=requirePage(targetPageNumber,pageCount);
  if(from===to)return Uint8Array.from(bytes);
  const order=Array.from({length:pageCount},(_,i)=>i);
  const [moved]=order.splice(from,1);
  order.splice(to,0,moved);
  const output=await PDFDocument.create();
  const copied=await output.copyPages(source,order);
  copied.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function extractPdfPage(bytes:Uint8Array,pageNumber:number):Promise<Uint8Array>{
  const source=await load(bytes);
  const index=requirePage(pageNumber,source.getPageCount());
  const output=await PDFDocument.create();
  const [page]=await output.copyPages(source,[index]);
  output.addPage(page);
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function appendPdf(bytes:Uint8Array,appendBytes:Uint8Array):Promise<Uint8Array>{
  const [source,append]=await Promise.all([load(bytes),load(appendBytes)]);
  const output=await PDFDocument.create();
  const first=await output.copyPages(source,source.getPageIndices());
  first.forEach(page=>output.addPage(page));
  const second=await output.copyPages(append,append.getPageIndices());
  second.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function insertBlankPdfPage(bytes:Uint8Array,afterPageNumber:number):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const index=requirePage(afterPageNumber,pdf.getPageCount());
  const reference=pdf.getPage(index);
  const {width,height}=reference.getSize();
  pdf.insertPage(index+1,[width,height]);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}


function normalized(value:number,label:string):number{
  if(!Number.isFinite(value)||value<0||value>1) throw new Error(`${label} must be between 0 and 1.`);
  return value;
}

export interface PdfTextOverlay {
  pageNumber:number;
  text:string;
  x:number;
  y:number;
  size:number;
}

export interface PdfRectangleOverlay {
  pageNumber:number;
  x:number;
  y:number;
  width:number;
  height:number;
  opacity?:number;
  mode?:'highlight'|'outline';
}

export async function addPdfTextOverlay(bytes:Uint8Array,overlay:PdfTextOverlay):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(overlay.pageNumber,pdf.getPageCount()));
  const text=overlay.text.replace(/[\u0000-\u001F]/g,' ').trim().slice(0,2000);
  if(!text) throw new Error('Text overlay is empty.');
  if(!Number.isFinite(overlay.size)||overlay.size<4||overlay.size>144) throw new Error('Text size must be between 4 and 144 points.');
  const x=normalized(overlay.x,'Text X');
  const y=normalized(overlay.y,'Text Y');
  const {width,height}=page.getSize();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(text,{
    x:x*width,
    y:y*height,
    size:overlay.size,
    font,
    color:rgb(0.05,0.08,0.12),
    maxWidth:Math.max(20,width-(x*width)-12),
    lineHeight:overlay.size*1.2,
  });
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function addPdfRectangleOverlay(bytes:Uint8Array,overlay:PdfRectangleOverlay):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(overlay.pageNumber,pdf.getPageCount()));
  const x=normalized(overlay.x,'Rectangle X');
  const y=normalized(overlay.y,'Rectangle Y');
  const widthFraction=normalized(overlay.width,'Rectangle width');
  const heightFraction=normalized(overlay.height,'Rectangle height');
  if(widthFraction<=0||heightFraction<=0||x+widthFraction>1||y+heightFraction>1){
    throw new Error('Rectangle must have positive size and remain inside the page.');
  }
  const opacity=overlay.opacity??0.28;
  if(!Number.isFinite(opacity)||opacity<0.05||opacity>1) throw new Error('Rectangle opacity must be between 0.05 and 1.');
  const {width,height}=page.getSize();
  if((overlay.mode??'highlight')==='outline'){
    page.drawRectangle({
      x:x*width,y:y*height,width:widthFraction*width,height:heightFraction*height,
      borderColor:rgb(0.08,0.48,0.78),borderWidth:1.5,opacity,
    });
  }else{
    page.drawRectangle({
      x:x*width,y:y*height,width:widthFraction*width,height:heightFraction*height,
      color:rgb(1,0.88,0.18),opacity,
    });
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function extractPdfRange(bytes:Uint8Array,startPage:number,endPage:number):Promise<Uint8Array>{
  const source=await load(bytes);
  const pageCount=source.getPageCount();
  const start=requirePage(startPage,pageCount);
  const end=requirePage(endPage,pageCount);
  if(end<start) throw new Error('End page must be greater than or equal to start page.');
  const output=await PDFDocument.create();
  const indices=Array.from({length:end-start+1},(_,index)=>start+index);
  const copied=await output.copyPages(source,indices);
  copied.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}
