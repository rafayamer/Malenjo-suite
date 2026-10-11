import {PDFArray,PDFDict,PDFDocument,PDFName} from 'pdf-lib';
import {zipSync} from 'fflate';
import {listPdfOutlineTree} from './pdfOutlineTree';

/**
 * Truly offline bookmark-based chapter splitting. Only top-level explicit
 * page destinations are accepted. Every source page is included exactly once;
 * preface pages before the first bookmark become a separate front-matter PDF.
 * The source bytes are never modified. PDF annotations, forms, certificates
 * and signatures are refused rather than orphaned or silently invalidated.
 */
export const PDF_CHAPTER_SPLIT_MAX_INPUT_BYTES=32*1024*1024;
export const PDF_CHAPTER_SPLIT_MAX_OUTPUT_BYTES=32*1024*1024;
export const PDF_CHAPTER_SPLIT_MAX_PARTS=50;
export const PDF_CHAPTER_SPLIT_MAX_PAGES=200;

export interface PdfChapterSplitEntry{
  name:string;
  filename:string;
  firstPage:number;
  lastPage:number;
}
export interface PdfChapterSplitResult{
  archive:Uint8Array;
  sourcePageCount:number;
  chapters:PdfChapterSplitEntry[];
}

function checkSafeDocument(pdf:PDFDocument):void{
  if(pdf.catalog.has(PDFName.of('Perms'))||
     pdf.catalog.has(PDFName.of('AcroForm'))){
    throw new Error('Chapter splitting refuses certified or interactive form PDFs.');
  }
  const ft=PDFName.of('FT'),sig=PDFName.of('ByteRange'),type=PDFName.of('Type');
  const objects=pdf.context.enumerateIndirectObjects();
  if(objects.length>20000)throw new Error('Chapter splitting exceeds the 20,000-object safety limit.');
  if(objects.some(([,value])=>value instanceof PDFDict&&(
    value.has(sig)||value.get(ft)?.toString()==='/Sig'||
    value.get(type)?.toString()==='/Sig'
  ))){
    throw new Error('Chapter splitting refuses signature-bearing PDFs.');
  }
  for(const [index,page] of pdf.getPages().entries()){
    const annots=page.node.get(PDFName.of('Annots'));
    if(!annots)continue;
    const value=pdf.context.lookup(annots);
    if(!(value instanceof PDFArray)||value.size()>0){
      throw new Error('Page '+(index+1)+' has annotations, links or widgets; chapter splitting refused.');
    }
  }
}
function slug(title:string):string{
  const clean=title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'')
    .slice(0,48).replace(/-+$/,'').toLowerCase();
  return clean||'chapter';
}

export async function splitPdfByChapters(
  source:Uint8Array,
  maxArchiveBytes=PDF_CHAPTER_SPLIT_MAX_OUTPUT_BYTES,
):Promise<PdfChapterSplitResult>{
  if(!(source instanceof Uint8Array)||source.length<5||
     source.length>PDF_CHAPTER_SPLIT_MAX_INPUT_BYTES){
    throw new Error('Offline chapter splitting requires a PDF of at most 32 MB.');
  }
  if(!Number.isSafeInteger(maxArchiveBytes)||maxArchiveBytes<1024||
     maxArchiveBytes>PDF_CHAPTER_SPLIT_MAX_OUTPUT_BYTES){
    throw new Error('Chapter archive budget must be between 1 KB and 32 MB.');
  }
  const pdf=await PDFDocument.load(source,{ignoreEncryption:false,updateMetadata:false});
  const count=pdf.getPageCount();
  if(count<2||count>PDF_CHAPTER_SPLIT_MAX_PAGES){
    throw new Error('Chapter splitting supports 2 to 200 pages.');
  }
  checkSafeDocument(pdf);
  const outlines=await listPdfOutlineTree(source);
  const starts=outlines.filter(item=>item.depth===0);
  if(!starts.length){
    throw new Error('This PDF has no top-level chapter bookmarks with page destinations.');
  }
  if(starts.length>PDF_CHAPTER_SPLIT_MAX_PARTS){
    throw new Error('More than 50 chapters were found.');
  }
  if(starts.some(item=>item.pageNumber===null)){
    throw new Error('Chapter splitting requires explicit page destinations; named or external destinations cannot be resolved safely.');
  }
  let previous=0;
  for(const item of starts){
    const number=item.pageNumber!;
    if(!Number.isSafeInteger(number)||number<=previous||number>count){
      throw new Error('Top-level chapter bookmarks must target distinct, strictly increasing page numbers.');
    }
    previous=number;
  }
  const intervals:Array<{name:string;first:number;end:number}>=[];
  if(starts[0].pageNumber!>1){
    intervals.push({name:'Front matter',first:1,end:starts[0].pageNumber!-1});
  }
  for(let i=0;i<starts.length;i++){
    intervals.push({
      name:starts[i].title,
      first:starts[i].pageNumber!,
      end:i+1<starts.length?starts[i+1].pageNumber!-1:count,
    });
  }
  if(intervals.length<2||intervals.length>PDF_CHAPTER_SPLIT_MAX_PARTS){
    throw new Error('At least two chapters or front matter plus a chapter are needed for splitting.');
  }
  const sum=intervals.reduce((n,item)=>n+item.end-item.first+1,0);
  if(sum!==count||intervals.some(item=>item.end<item.first)){
    throw new Error('Chapter intervals do not cover each PDF page exactly once.');
  }
  let total=0;
  const archiveBudget=maxArchiveBytes-intervals.length*256-128;
  if(archiveBudget<=0)throw new Error('Too little ZIP archive budget for the chapter count.');
  const members:Record<string,Uint8Array>={};
  const chapters:PdfChapterSplitEntry[]=[];
  for(let i=0;i<intervals.length;i++){
    const item=intervals[i];
    const indices=Array.from({length:item.end-item.first+1},(_,offset)=>item.first-1+offset);
    const output=await PDFDocument.create();
    const pages=await output.copyPages(pdf,indices);
    pages.forEach(page=>output.addPage(page));
    const bytes=Uint8Array.from(await output.save({useObjectStreams:false}));
    total+=bytes.length;
    if(total>archiveBudget){
      throw new Error('Chapter PDF files exceed the configured ZIP archive budget.');
    }
    const reopened=await PDFDocument.load(bytes,{updateMetadata:false});
    if(reopened.getPageCount()!==indices.length||
       reopened.getPages().some((page,index)=>{
         const original=pdf.getPage(indices[index]);
         return Math.abs(page.getWidth()-original.getWidth())>0.01||
           Math.abs(page.getHeight()-original.getHeight())>0.01;
       })){
      throw new Error('Chapter '+(i+1)+' could not be reopened with its original page geometry.');
    }
    const filename='chapter-'+String(i+1).padStart(3,'0')+'-'+slug(item.name)+'.pdf';
    members[filename]=bytes;
    chapters.push({
      name:item.name,filename,firstPage:item.first,lastPage:item.end,
    });
  }
  const archive=zipSync(members,{level:0});
  if(archive.length>maxArchiveBytes){
    throw new Error('Final chapter ZIP exceeds the 32 MB export budget.');
  }
  return {archive,sourcePageCount:count,chapters};
}
