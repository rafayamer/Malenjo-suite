/** Per-document HTML drag payload; never accept arbitrary external page drops. */
export const PDF_PAGE_DRAG_TYPE = 'application/x-malenjo-pdf-page';

export function createPdfPageDragPayload(scope:string,page:number):string{
  if(!scope||scope.length>200||!Number.isSafeInteger(page)||page<1){
    throw new Error('Invalid PDF page drag source.');
  }
  return JSON.stringify({v:1,scope,page});
}

export function readPdfPageDragPayload(payload:string,scope:string,pageCount:number):number|null{
  if(!payload||payload.length>512||!scope||!Number.isSafeInteger(pageCount)||pageCount<1)return null;
  try{
    const value:unknown=JSON.parse(payload);
    if(!value||typeof value!=='object')return null;
    const candidate=value as {v?:unknown;scope?:unknown;page?:unknown};
    if(candidate.v!==1||candidate.scope!==scope)return null;
    const page=candidate.page;
    return typeof page==='number'&&Number.isSafeInteger(page)&&page>=1&&page<=pageCount?page:null;
  }catch{
    return null;
  }
}
