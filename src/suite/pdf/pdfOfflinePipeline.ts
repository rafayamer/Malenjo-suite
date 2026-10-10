import {
  degrees,PDFArray,PDFDict,PDFDocument,PDFName,
} from 'pdf-lib';

/**
 * Strict, offline page-organization pipeline. This is NOT a general Stirling
 * processing pipeline: supported steps are rotate, delete and move only.
 * All validation is applied before output is exposed to the active workspace.
 */
export type PdfOfflinePipelineStep=
  |{action:'rotate';pages:number[];angle:90|180|270}
  |{action:'delete';pages:number[]}
  |{action:'move';from:number;to:number};

export const PDF_OFFLINE_PIPELINE_MAX_SOURCE_BYTES=32*1024*1024;
export const PDF_OFFLINE_PIPELINE_MAX_STEPS=20;
const MAX_PAGE_COUNT=200;

function isRecord(value:unknown):value is Record<string,unknown>{
  return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
}
function exactKeys(record:Record<string,unknown>,keys:string[]):boolean{
  return Object.keys(record).length===keys.length&&keys.every(key=>Object.hasOwn(record,key));
}
function pagesFrom(input:unknown):number[]{
  if(!Array.isArray(input)||!input.length||input.length>MAX_PAGE_COUNT||
    !input.every(value=>Number.isSafeInteger(value)&&value>=1&&value<=MAX_PAGE_COUNT)||
    new Set(input).size!==input.length){
    throw new Error('Pipeline page lists require distinct 1-based integers between 1 and 200.');
  }
  return input as number[];
}

export function parseOfflinePdfPipeline(json:string):PdfOfflinePipelineStep[]{
  if(!json.trim()||json.length>8192){
    throw new Error('PDF pipeline requires nonempty JSON of at most 8,192 characters.');
  }
  let value:unknown;
  try{value=JSON.parse(json);}
  catch{throw new Error('PDF pipeline must contain valid JSON.');}
  if(!Array.isArray(value)||!value.length||value.length>PDF_OFFLINE_PIPELINE_MAX_STEPS){
    throw new Error('PDF pipeline requires 1 to 20 steps.');
  }
  return value.map((raw:unknown,index:number):PdfOfflinePipelineStep=>{
    if(!isRecord(raw))throw new Error('Pipeline step '+(index+1)+' must be an object.');
    if(raw.action==='rotate'){
      if(!exactKeys(raw,['action','pages','angle'])||
        ![90,180,270].includes(raw.angle as number)){
        throw new Error('Rotation steps need action, pages and angle of 90, 180 or 270 degrees.');
      }
      return {action:'rotate',pages:pagesFrom(raw.pages),angle:raw.angle as 90|180|270};
    }
    if(raw.action==='delete'){
      if(!exactKeys(raw,['action','pages'])){
        throw new Error('Delete steps need action and pages only.');
      }
      return {action:'delete',pages:pagesFrom(raw.pages)};
    }
    if(raw.action==='move'){
      if(!exactKeys(raw,['action','from','to'])||
        !Number.isSafeInteger(raw.from)||!Number.isSafeInteger(raw.to)||
        (raw.from as number)<1||(raw.from as number)>MAX_PAGE_COUNT||
        (raw.to as number)<1||(raw.to as number)>MAX_PAGE_COUNT){
        throw new Error('Move steps require 1-based from and to integers between 1 and 200.');
      }
      return {action:'move',from:raw.from as number,to:raw.to as number};
    }
    throw new Error('Pipeline step '+(index+1)+' has an unsupported action.');
  });
}

function rejectInteractivePdf(pdf:PDFDocument):void{
  for(const key of ['Perms','AcroForm','Outlines','Names','PageLabels','StructTreeRoot']){
    if(pdf.catalog.get(PDFName.of(key))){
      throw new Error('PDF contains '+key+' document structures; page automation is refused to avoid breaking interactive data.');
    }
  }
  const sig=PDFName.of('ByteRange'),ft=PDFName.of('FT');
  if(pdf.context.enumerateIndirectObjects().some(([,object])=>
    object instanceof PDFDict&&(object.has(sig)||object.get(ft)?.toString()==='/Sig'))){
    throw new Error('Signed PDF cannot be processed by the offline page pipeline.');
  }
  for(const [index,page] of pdf.getPages().entries()){
    const annots=page.node.get(PDFName.of('Annots'));
    if(annots){
      const resolved=pdf.context.lookup(annots);
      if(!(resolved instanceof PDFArray)||resolved.size()>0){
        throw new Error('Page '+(index+1)+' contains annotations, links or form widgets; pipeline refused.');
      }
    }
  }
}

export async function runOfflinePdfPipeline(
  source:Uint8Array,
  steps:readonly PdfOfflinePipelineStep[],
):Promise<Uint8Array>{
  if(!(source instanceof Uint8Array)||!source.length||
    source.byteLength>PDF_OFFLINE_PIPELINE_MAX_SOURCE_BYTES){
    throw new Error('Offline pipeline accepts nonempty PDF files up to 32 MB.');
  }
  if(!steps.length||steps.length>PDF_OFFLINE_PIPELINE_MAX_STEPS){
    throw new Error('Offline pipeline requires 1 to 20 steps.');
  }
  const pdf=await PDFDocument.load(source,{ignoreEncryption:false,updateMetadata:false});
  if(!pdf.getPageCount()||pdf.getPageCount()>MAX_PAGE_COUNT){
    throw new Error('Offline pipeline supports 1 to 200 PDF pages.');
  }
  rejectInteractivePdf(pdf);
  // Re-parse a serialization of the plan to reject untrusted direct callers,
  // excess keys, sparse page arrays or accidental mutation.
  const validated=parseOfflinePdfPipeline(JSON.stringify(steps));
  for(const [index,step] of validated.entries()){
    const count=pdf.getPageCount();
    const valid=(number:number)=>number>=1&&number<=count;
    if(step.action==='move'){
      if(!valid(step.from)||!valid(step.to)){
        throw new Error('Pipeline move step '+(index+1)+' refers to a missing page.');
      }
      if(step.from!==step.to){
        const page=pdf.getPage(step.from-1);
        pdf.removePage(step.from-1);
        pdf.insertPage(step.to-1,page);
      }
    }else{
      if(step.pages.some(page=>!valid(page))){
        throw new Error('Pipeline step '+(index+1)+' refers to a missing page.');
      }
      if(step.action==='delete'){
        if(step.pages.length>=count){
          throw new Error('Pipeline cannot delete every PDF page.');
        }
        for(const page of [...step.pages].sort((a,b)=>b-a)){
          pdf.removePage(page-1);
        }
      }else{
        for(const number of step.pages){
          const page=pdf.getPage(number-1);
          page.setRotation(degrees((page.getRotation().angle+step.angle)%360));
        }
      }
    }
  }
  const expected=pdf.getPages().map(page=>({
    width:page.getWidth(),height:page.getHeight(),rotation:page.getRotation().angle,
  }));
  const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
  if(bytes.byteLength>PDF_OFFLINE_PIPELINE_MAX_SOURCE_BYTES){
    throw new Error('Offline pipeline result exceeds the 32 MB limit.');
  }
  const reopened=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
  const actual=reopened.getPages().map(page=>({
    width:page.getWidth(),height:page.getHeight(),rotation:page.getRotation().angle,
  }));
  if(JSON.stringify(actual)!==JSON.stringify(expected)){
    throw new Error('Offline page pipeline output did not reopen with expected page order and geometry.');
  }
  return bytes;
}
