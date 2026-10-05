import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PdfSearchPage {
  page: number;
  text: string;
}

export interface PdfSearchResult {
  id: string;
  page: number;
  excerpt: string;
  matchIndex: number;
}

export interface PdfOutlineEntry {
  id: string;
  title: string;
  depth: number;
  page: number | null;
  bold: boolean;
  italic: boolean;
}

export interface PdfAttachmentEntry {
  id: string;
  name: string;
  sizeBytes: number;
  content: Uint8Array;
}

function cleanText(value:string):string{
  return value.replace(/\s+/g,' ').trim();
}

export async function buildPdfSearchIndex(
  document: PDFDocumentProxy,
  onProgress?: (completed:number,total:number)=>void,
):Promise<PdfSearchPage[]>{
  const total=document.numPages;
  const pages:PdfSearchPage[]=[];
  for(let pageNumber=1;pageNumber<=total;pageNumber+=1){
    const page=await document.getPage(pageNumber);
    const content=await page.getTextContent();
    const text=cleanText(content.items
      .map((item)=>'str' in item?String(item.str):'')
      .filter(Boolean)
      .join(' '));
    pages.push({page:pageNumber,text});
    onProgress?.(pageNumber,total);
  }
  return pages;
}

export function searchPdfIndex(
  index:PdfSearchPage[],
  query:string,
  maxResults=250,
):PdfSearchResult[]{
  const needle=cleanText(query).toLocaleLowerCase();
  if(!needle)return[];
  const results:PdfSearchResult[]=[];
  for(const page of index){
    const haystack=page.text.toLocaleLowerCase();
    let start=0;
    let ordinal=0;
    while(start<haystack.length&&results.length<maxResults){
      const found=haystack.indexOf(needle,start);
      if(found<0)break;
      ordinal+=1;
      const excerptStart=Math.max(0,found-55);
      const excerptEnd=Math.min(page.text.length,found+needle.length+85);
      results.push({
        id:`p${page.page}-m${ordinal}-${found}`,
        page:page.page,
        excerpt:`${excerptStart>0?'…':''}${page.text.slice(excerptStart,excerptEnd)}${excerptEnd<page.text.length?'…':''}`,
        matchIndex:found,
      });
      start=found+Math.max(1,needle.length);
    }
    if(results.length>=maxResults)break;
  }
  return results;
}

type OutlineItem=NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number];

async function destinationPage(document:PDFDocumentProxy,destination:OutlineItem['dest']):Promise<number|null>{
  if(!destination)return null;
  const resolved=typeof destination==='string'
    ? await document.getDestination(destination)
    : destination;
  if(!Array.isArray(resolved)||resolved.length===0)return null;
  const first=resolved[0];
  if(typeof first==='number'&&Number.isInteger(first))return first+1;
  if(first&&typeof first==='object'){
    try{
      return (await document.getPageIndex(first))+1;
    }catch{
      return null;
    }
  }
  return null;
}

export async function readPdfOutline(document:PDFDocumentProxy):Promise<PdfOutlineEntry[]>{
  const root=await document.getOutline();
  if(!root?.length)return[];
  const output:PdfOutlineEntry[]=[];
  let sequence=0;

  async function visit(items:OutlineItem[],depth:number){
    for(const item of items){
      sequence+=1;
      output.push({
        id:`outline-${sequence}`,
        title:item.title?.trim()||`Bookmark ${sequence}`,
        depth,
        page:await destinationPage(document,item.dest),
        bold:Boolean(item.bold),
        italic:Boolean(item.italic),
      });
      if(item.items?.length)await visit(item.items,depth+1);
    }
  }

  await visit(root,0);
  return output;
}

export async function readPdfAttachments(document:PDFDocumentProxy):Promise<PdfAttachmentEntry[]>{
  const attachments=await document.getAttachments();
  if(!attachments)return[];
  return Object.entries(attachments).map(([key,value],index)=>{
    const content=Uint8Array.from(value.content);
    return {
      id:`attachment-${index+1}-${key}`,
      name:value.filename||key||`Attachment ${index+1}`,
      sizeBytes:content.byteLength,
      content,
    };
  });
}
