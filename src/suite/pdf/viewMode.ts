export type PdfViewMode='continuous'|'single'|'two';

// Continuous mode is recomputed on every workspace state update (scroll,
// render, progress, inspector). Reuse the immutable page index instead of
// allocating thousands of integers repeatedly for a long document.
let continuousCount=0;
let continuousPages:readonly number[]=[];

export function pdfViewPages(mode:PdfViewMode,currentPage:number,pageCount:number):readonly number[]{
  if(pageCount<=0)return [];
  const current=Math.min(pageCount,Math.max(1,Math.trunc(currentPage)||1));
  if(mode==='continuous'){
    if(continuousCount!==pageCount){
      continuousPages=Object.freeze(Array.from({length:pageCount},(_,index)=>index+1));
      continuousCount=pageCount;
    }
    return continuousPages;
  }
  if(mode==='single')return [current];
  const first=current%2===0?current-1:current;
  return [first,first+1].filter((page)=>page<=pageCount);
}

export function nextPdfViewPage(mode:PdfViewMode,currentPage:number,pageCount:number,direction:1|-1):number{
  if(pageCount<=0)return 1;
  const step=mode==='two'?2:1;
  return Math.min(pageCount,Math.max(1,currentPage+step*direction));
}
