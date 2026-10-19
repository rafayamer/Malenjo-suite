import type { LibraryDocument } from '../files/types';
import type { Citation } from './rag';

export interface AiCitationNavigationTarget{
  documentId:string;
  documentName:string;
  page:number|null;
  slide:number|null;
  row:number|null;
  chunkId:string;
}

function positiveInt(match:RegExpMatchArray|null):number|null{
  if(!match)return null;
  const value=Number(match[1]);
  return Number.isInteger(value)&&value>0?value:null;
}

export function citationDocumentId(sourceId:string):string|null{
  const prefix='open-document-';
  return sourceId.startsWith(prefix)&&sourceId.length>prefix.length
    ? sourceId.slice(prefix.length)
    : null;
}

export function inferCitationLocation(text:string):Pick<AiCitationNavigationTarget,'page'|'slide'|'row'>{
  return {
    page:positiveInt(text.match(/(?:^|\n)Page\s+(\d+)\b/i)),
    slide:positiveInt(text.match(/(?:^|\n)Slide\s+(\d+)\b/i)),
    row:positiveInt(text.match(/(?:^|\n)Row\s+(\d+)\s*:/i)),
  };
}

export function resolveCitationNavigation(
  citation:Citation,
  openDocuments:LibraryDocument[],
):AiCitationNavigationTarget|null{
  const documentId=citationDocumentId(citation.sourceId);
  if(!documentId)return null;
  const document=openDocuments.find((item)=>item.id===documentId);
  if(!document)return null;
  const location=inferCitationLocation(citation.excerpt);
  return {
    documentId,
    documentName:document.name,
    ...location,
    chunkId:citation.chunkId,
  };
}

export function citationNavigationLabel(target:AiCitationNavigationTarget):string{
  if(target.page)return `${target.documentName} · page ${target.page}`;
  if(target.slide)return `${target.documentName} · slide ${target.slide}`;
  if(target.row)return `${target.documentName} · row ${target.row}`;
  return target.documentName;
}
