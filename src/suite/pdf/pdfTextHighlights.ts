/**
 * Highlight actual PDF.js text spans, never raster pixels or arbitrary HTML.
 * All strings are inserted as text nodes (including untrusted PDF content).
 * No network, script execution, innerHTML or source document modification.
 */
export interface PdfTextMatch{start:number;end:number}
export function findPdfTextMatches(text:string,query:string,max=100):PdfTextMatch[]{
  const needle=query.trim().toLocaleLowerCase();
  if(!needle||!Number.isSafeInteger(max)||max<1||max>1000)return [];
  const haystack=text.toLocaleLowerCase();
  const result:PdfTextMatch[]=[];
  let offset=0;
  while(offset<haystack.length&&result.length<max){
    const start=haystack.indexOf(needle,offset);
    if(start<0)break;
    result.push({start,end:start+needle.length});
    offset=start+Math.max(needle.length,1);
  }
  return result;
}
/** Restore the exact PDF.js text before every highlight update. */
export function highlightPdfTextNodes(nodes:readonly HTMLSpanElement[],query:string):number{
  let count=0;
  const needle=query.trim();
  for(const span of nodes){
    const original=span.dataset.malenjoOriginalText??span.textContent??'';
    span.dataset.malenjoOriginalText=original;
    const matches=findPdfTextMatches(original,needle,100);
    if(!matches.length){
      if(span.textContent!==original)span.textContent=original;
      continue;
    }
    const doc=span.ownerDocument;
    const fragment=doc.createDocumentFragment();
    let last=0;
    for(const hit of matches){
      fragment.appendChild(doc.createTextNode(original.slice(last,hit.start)));
      const mark=doc.createElement('mark');
      mark.className='pdf-text-match';
      mark.textContent=original.slice(hit.start,hit.end);
      fragment.appendChild(mark);
      last=hit.end;
      count++;
    }
    fragment.appendChild(doc.createTextNode(original.slice(last)));
    span.replaceChildren(fragment);
  }
  return count;
}
/** PDF.js text items need space-aware concatenation for useful Find results. */
export function extractPdfPageSearchText(items:readonly unknown[]):string{
  let result='';
  for(const entry of items){
    if(!entry||typeof entry!=='object')continue;
    // PDF.js includes marked-content records without text fields.
    const item=entry as {str?:unknown;hasEOL?:unknown};
    if(typeof item.str==='string')result+=item.str;
    if(item.hasEOL===true)result+='\n';
    else if(typeof item.str==='string'&&item.str&&!/\s$/.test(item.str))result+=' ';
  }
  return result.replace(/\s+/g,' ').trim();
}
