import { disposePdf, loadPdfBytes } from '../pdf/engine';
import { readPdfDocumentBytes } from '../pdf/api';
import { parseOffice } from '../office/ooxml';
import { readOfficeDocument } from '../office/api';
import type { LibraryDocument } from '../files/types';
import type { SourceDocument } from './rag';

const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024;

export function isAiSourceSizeAllowed(sizeBytes:number):boolean{
  return Number.isFinite(sizeBytes)&&sizeBytes>0&&sizeBytes<=MAX_SOURCE_FILE_BYTES;
}

function sourceId(name: string): string {
  return `source-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function openDocumentSourceId(documentId:string):string {
  return `open-document-${documentId}`;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const loaded = await loadPdfBytes(bytes);
  try {
    const pages: string[] = [];
    const count = Math.min(loaded.document.numPages, 500);
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      const page = await loaded.document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => 'str' in item ? String(item.str) : '')
        .filter(Boolean)
        .join(' ');
      pages.push(`Page ${pageNumber}\n${text}`);
    }
    return pages.join('\n\n');
  } finally {
    await disposePdf(loaded);
  }
}

function officeText(bytes: Uint8Array): string {
  const model = parseOffice(bytes);
  if (model.kind === 'docx') return model.paragraphs.join('\n\n');
  if (model.kind === 'xlsx') {
    return model.cells.map((row, index) => `Row ${index + 1}: ${row.join('\t')}`).join('\n');
  }
  return model.slides.map((slide, index) => `Slide ${index + 1}: ${slide.texts.join('\n')}`).join('\n\n');
}

async function extractNamedBytes(
  name:string,
  bytes:Uint8Array,
  stableId?:string,
):Promise<SourceDocument> {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SOURCE_FILE_BYTES) {
    throw new Error(`${name}: source files must be between 1 byte and 100 MB.`);
  }

  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  let text = '';

  if (extension === 'pdf') {
    text = await pdfText(bytes);
  } else if (['docx','xlsx','pptx'].includes(extension)) {
    text = officeText(bytes);
  } else if (['txt','md','csv','json','log','xml','html'].includes(extension)) {
    text = new TextDecoder().decode(bytes);
  } else {
    throw new Error(`${name}: unsupported RAG source type.`);
  }

  if (!text.trim()) throw new Error(`${name}: no indexable text was found.`);
  return { id:stableId??sourceId(name), name, text };
}

export async function extractSourceDocument(file: File): Promise<SourceDocument> {
  if (!isAiSourceSizeAllowed(file.size)) {
    throw new Error(`${file.name}: source files must be between 1 byte and 100 MB.`);
  }
  return extractNamedBytes(file.name,new Uint8Array(await file.arrayBuffer()));
}

export function isOpenDocumentAiSource(document:LibraryDocument):boolean {
  if(document.browserFile){
    const extension=document.name.split('.').pop()?.toLowerCase()??'';
    return ['pdf','docx','xlsx','pptx','txt','md','csv','json','log','xml','html'].includes(extension);
  }
  const extension=document.name.split('.').pop()?.toLowerCase()??'';
  return document.available&&['pdf','docx','xlsx','pptx'].includes(extension);
}

export async function extractOpenDocumentSource(document:LibraryDocument):Promise<SourceDocument> {
  if(!isOpenDocumentAiSource(document)){
    throw new Error(`${document.name}: this open document type is not currently indexable by Malenjo AI.`);
  }

  const stableId=openDocumentSourceId(document.id);
  if(document.sizeBytes<=0||document.sizeBytes>MAX_SOURCE_FILE_BYTES){
    throw new Error(`${document.name}: source files must be between 1 byte and 100 MB.`);
  }
  if(document.browserFile){
    const file=document.browserFile;
    if(!isAiSourceSizeAllowed(file.size)){
      throw new Error(`${file.name}: source files must be between 1 byte and 100 MB.`);
    }
    return extractNamedBytes(file.name,new Uint8Array(await file.arrayBuffer()),stableId);
  }

  if(!isAiSourceSizeAllowed(document.sizeBytes)){
    throw new Error(`${document.name}: source files must be between 1 byte and 100 MB.`);
  }

  if(document.kind==='pdf'){
    const bytes=await readPdfDocumentBytes(document.id);
    return extractNamedBytes(document.name,new Uint8Array(bytes),stableId);
  }

  if(['docx','xlsx','pptx'].includes(document.kind)){
    const bytes=await readOfficeDocument(document.id);
    return extractNamedBytes(document.name,new Uint8Array(bytes),stableId);
  }

  throw new Error(`${document.name}: no safe local read boundary is available for AI indexing.`);
}
