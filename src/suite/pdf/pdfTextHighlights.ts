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
  const originals=nodes.map((span)=>{
    const original=span.dataset.malenjoOriginalText??span.textContent??'';
    span.dataset.malenjoOriginalText=original;
    return original;
  });
  // Search the combined text, not each span in isolation. A word can span
  // several PDF.js runs and should still highlight without mutating the PDF.
  const haystack=originals.join('');
  const matches=findPdfTextMatches(haystack,query,100);
  let offset=0;
  nodes.forEach((span,index)=>{
    const original=originals[index];
    const end=offset+original.length;
    const hits=matches
      .filter((hit)=>hit.start<end&&hit.end>offset)
      .map((hit)=>({start:Math.max(0,hit.start-offset),end:Math.min(original.length,hit.end-offset)}));
    const fragment=span.ownerDocument.createDocumentFragment();
    let last=0;
    for(const hit of hits){
      fragment.appendChild(span.ownerDocument.createTextNode(original.slice(last,hit.start)));
      const mark=span.ownerDocument.createElement('mark');
      mark.className='pdf-text-match';
      mark.textContent=original.slice(hit.start,hit.end);
      fragment.appendChild(mark);
      last=hit.end;
    }
    fragment.appendChild(span.ownerDocument.createTextNode(original.slice(last)));
    span.replaceChildren(fragment);
    offset=end;
  });
  return matches.length;
}
/** Preserve PDF.js text-run adjacency; do not invent separators that
 * break words split across glyph/font runs. Explicit run spaces and EOL stay.
 */
export function extractPdfPageSearchText(items:readonly unknown[]):string{
  let result='';
  for(const entry of items){
    if(!entry||typeof entry!=='object')continue;
    const item=entry as {str?:unknown;hasEOL?:unknown};
    if(typeof item.str==='string')result+=item.str;
    if(item.hasEOL===true)result+='\n';
  }
  return result.replace(/\s+/g,' ').trim();
}
