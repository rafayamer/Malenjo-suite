import { PDFDocument, degrees } from 'pdf-lib';

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


function requirePages(pageNumbers:number[],pageCount:number):number[]{
  const pages=Array.from(new Set(pageNumbers.map(value=>requirePage(value,pageCount)))).sort((a,b)=>a-b);
  if(!pages.length)throw new Error('Select at least one PDF page.');
  return pages;
}

export async function deletePdfPages(bytes:Uint8Array,pageNumbers:number[]):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const indices=requirePages(pageNumbers,pdf.getPageCount());
  if(indices.length>=pdf.getPageCount())throw new Error('A PDF must keep at least one page.');
  [...indices].sort((a,b)=>b-a).forEach(index=>pdf.removePage(index));
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function rotatePdfPagesPermanent(bytes:Uint8Array,pageNumbers:number[]):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const indices=requirePages(pageNumbers,pdf.getPageCount());
  for(const index of indices){
    const page=pdf.getPage(index);
    const current=((page.getRotation().angle%360)+360)%360;
    page.setRotation(degrees((current+90)%360));
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function extractPdfPages(bytes:Uint8Array,pageNumbers:number[]):Promise<Uint8Array>{
  const source=await load(bytes);
  const indices=requirePages(pageNumbers,source.getPageCount());
  const output=await PDFDocument.create();
  const copied=await output.copyPages(source,indices);
  copied.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function insertPdfAfter(bytes:Uint8Array,insertBytes:Uint8Array,afterPageNumber:number):Promise<Uint8Array>{
  const [source,insert]=await Promise.all([load(bytes),load(insertBytes)]);
  const after=requirePage(afterPageNumber,source.getPageCount());
  const output=await PDFDocument.create();
  const beforeIndices=source.getPageIndices().filter(index=>index<=after);
  const afterIndices=source.getPageIndices().filter(index=>index>after);
  const before=await output.copyPages(source,beforeIndices);
  before.forEach(page=>output.addPage(page));
  const inserted=await output.copyPages(insert,insert.getPageIndices());
  inserted.forEach(page=>output.addPage(page));
  const trailing=await output.copyPages(source,afterIndices);
  trailing.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function splitPdfAtPage(bytes:Uint8Array,pageNumber:number):Promise<[Uint8Array,Uint8Array]>{
  const source=await load(bytes);
  const pageCount=source.getPageCount();
  const splitIndex=requirePage(pageNumber,pageCount);
  if(splitIndex>=pageCount-1)throw new Error('Choose a split point before the last PDF page.');

  const left=await PDFDocument.create();
  const right=await PDFDocument.create();
  const leftPages=await left.copyPages(source,Array.from({length:splitIndex+1},(_,index)=>index));
  leftPages.forEach(page=>left.addPage(page));
  const rightPages=await right.copyPages(source,Array.from({length:pageCount-splitIndex-1},(_,index)=>splitIndex+1+index));
  rightPages.forEach(page=>right.addPage(page));
  return [
    Uint8Array.from(await left.save({useObjectStreams:false})),
    Uint8Array.from(await right.save({useObjectStreams:false})),
  ];
}
