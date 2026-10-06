import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import {
  PDF_PROVIDER_CONTRACT_VERSION,
  type PdfProviderInputFile,
  type PdfProviderOperation,
  type PdfProviderOperationField,
  type PdfProviderResponse,
  type PdfProviderStatus,
  type PdfProviderToolCategory,
  type PdfToolProvider,
} from './backend';

export const STIRLING_OPEN_CORE_PIN='25220cbdbde2d526cebf173b94357884e180b8c1';

export interface StirlingFrontendTool {
  id:string;
  category:PdfProviderToolCategory;
}

export const STIRLING_FRONTEND_TOOLS:StirlingFrontendTool[]=[
  {id:'AddAttachments',category:'organize'},
  {id:'AddImage',category:'edit'},
  {id:'AddPageNumbers',category:'organize'},
  {id:'AddPassword',category:'protect'},
  {id:'AddStamp',category:'edit'},
  {id:'AddText',category:'edit'},
  {id:'AddWatermark',category:'protect'},
  {id:'AdjustContrast',category:'edit'},
  {id:'AdjustPageScale',category:'organize'},
  {id:'Annotate',category:'comment'},
  {id:'AutoRename',category:'home'},
  {id:'AutoRotate',category:'organize'},
  {id:'Automate',category:'automate'},
  {id:'BookletImposition',category:'organize'},
  {id:'CertSign',category:'sign'},
  {id:'ChangeMetadata',category:'protect'},
  {id:'ChangePermissions',category:'protect'},
  {id:'Compare',category:'home'},
  {id:'Compress',category:'convert'},
  {id:'Convert',category:'convert'},
  {id:'CreatePortfolio',category:'organize'},
  {id:'Crop',category:'organize'},
  {id:'EditTableOfContents',category:'organize'},
  {id:'ExtractImages',category:'convert'},
  {id:'ExtractPages',category:'organize'},
  {id:'Flatten',category:'forms'},
  {id:'GetPdfInfo',category:'home'},
  {id:'Merge',category:'organize'},
  {id:'OCR',category:'scan'},
  {id:'OverlayPdfs',category:'organize'},
  {id:'PageLayout',category:'organize'},
  {id:'Redact',category:'protect'},
  {id:'RemoveAnnotations',category:'comment'},
  {id:'RemoveBlanks',category:'organize'},
  {id:'RemoveCertificateSign',category:'sign'},
  {id:'RemoveImage',category:'edit'},
  {id:'RemovePages',category:'organize'},
  {id:'RemovePassword',category:'protect'},
  {id:'ReorganizePages',category:'organize'},
  {id:'Repair',category:'home'},
  {id:'ReplaceColor',category:'edit'},
  {id:'Rotate',category:'organize'},
  {id:'Sanitize',category:'protect'},
  {id:'ScannerImageSplit',category:'scan'},
  {id:'ShowJS',category:'protect'},
  {id:'Sign',category:'sign'},
  {id:'SingleLargePage',category:'organize'},
  {id:'Split',category:'organize'},
  {id:'SwaggerUI',category:'home'},
  {id:'TimestampPdf',category:'sign'},
  {id:'UnlockPdfForms',category:'forms'},
  {id:'ValidateSignature',category:'sign'},
  {id:'annotate',category:'comment'},
  {id:'autoFormDetection',category:'forms'},
  {id:'formFill',category:'forms'},
  {id:'pdfTextEditor',category:'edit'},
  {id:'stamp',category:'edit'},
];


type JsonRecord=Record<string,unknown>;

function isRecord(value:unknown):value is JsonRecord{
  return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
}

function decodePointerToken(value:string):string{
  return value.replace(/~1/g,'/').replace(/~0/g,'~');
}

function resolvePointer(document:JsonRecord,ref:string):unknown{
  if(!ref.startsWith('#/'))return undefined;
  let current:unknown=document;
  for(const rawToken of ref.slice(2).split('/')){
    const token=decodePointerToken(rawToken);
    if(!isRecord(current)||!(token in current))return undefined;
    current=current[token];
  }
  return current;
}

type ObjectRecord=Record<string,unknown>;

function mergeSchemas(parts:JsonRecord[]):JsonRecord{
  const properties:ObjectRecord={};
  const required=new Set<string>();
  let type:unknown;
  let description:unknown;
  for(const part of parts){
    if(part.type!==undefined)type=part.type;
    if(part.description!==undefined)description=part.description;
    if(isRecord(part.properties))Object.assign(properties,part.properties);
    if(Array.isArray(part.required)){
      for(const item of part.required)if(typeof item==='string')required.add(item);
    }
  }
  return {type,description,properties,required:[...required]};
}

function resolveSchema(document:JsonRecord,schema:unknown,depth=0,seen=new Set<string>()):JsonRecord{
  if(depth>16||!isRecord(schema))return {};
  if(typeof schema.$ref==='string'){
    if(seen.has(schema.$ref))return {};
    const target=resolvePointer(document,schema.$ref);
    if(target===undefined)return {};
    const nextSeen=new Set(seen);
    nextSeen.add(schema.$ref);
    const resolved=resolveSchema(document,target,depth+1,nextSeen);
    const siblings=Object.fromEntries(Object.entries(schema).filter(([key])=>key!=='$ref'));
    return {...resolved,...siblings};
  }
  if(Array.isArray(schema.allOf)){
    return {...mergeSchemas(schema.allOf.map((item)=>resolveSchema(document,item,depth+1,new Set(seen)))),...Object.fromEntries(Object.entries(schema).filter(([key])=>key!=='allOf'))};
  }
  if(Array.isArray(schema.oneOf)&&schema.oneOf.length){
    return {...resolveSchema(document,schema.oneOf[0],depth+1,new Set(seen)),...Object.fromEntries(Object.entries(schema).filter(([key])=>key!=='oneOf'))};
  }
  if(Array.isArray(schema.anyOf)&&schema.anyOf.length){
    return {...resolveSchema(document,schema.anyOf[0],depth+1,new Set(seen)),...Object.fromEntries(Object.entries(schema).filter(([key])=>key!=='anyOf'))};
  }
  return schema;
}

function resolveObject(document:JsonRecord,value:unknown):JsonRecord{
  return resolveSchema(document,value);
}

function titleFromName(name:string):string{
  return name
    .replace(/([a-z0-9])([A-Z])/g,'$1 $2')
    .replace(/[-_]+/g,' ')
    .replace(/\bPdf\b/g,'PDF')
    .replace(/\bOcr\b/g,'OCR')
    .replace(/^./,(value)=>value.toUpperCase());
}

function categoryForOperation(operation:JsonRecord,path:string):PdfProviderToolCategory{
  const text=[
    path,
    typeof operation.operationId==='string'?operation.operationId:'',
    typeof operation.summary==='string'?operation.summary:'',
    Array.isArray(operation.tags)?operation.tags.join(' '):'',
  ].join(' ').toLowerCase();

  if(/ocr|scanner|image.?split/.test(text))return 'scan';
  if(/sign|certificate|timestamp|signature/.test(text))return 'sign';
  if(/password|permission|redact|sanitize|watermark|javascript|security/.test(text))return 'protect';
  if(/form|flatten|field/.test(text))return 'forms';
  if(/annotat|comment|highlight|stamp/.test(text))return 'comment';
  if(/merge|split|page|rotate|crop|layout|booklet|overlay|portfolio|attachment|toc|table.?of.?contents/.test(text))return 'organize';
  if(/convert|compress|extract.?image|to.?pdf|from.?pdf/.test(text))return 'convert';
  if(/text|image|color|contrast|edit|replace/.test(text))return 'edit';
  if(/pipeline|automate/.test(text))return 'automate';
  return 'home';
}

function fieldFromSchema(
  document:JsonRecord,
  name:string,
  raw:unknown,
  required:boolean,
  location:'query'|'form',
):PdfProviderOperationField{
  const schema=resolveSchema(document,raw);
  const type=typeof schema.type==='string'?schema.type:'string';
  const format=typeof schema.format==='string'?schema.format:'';
  const items=resolveSchema(document,schema.items);
  const binary=type==='string'&&format==='binary';
  const binaryArray=type==='array'&&items.type==='string'&&items.format==='binary';

  let kind:PdfProviderOperationField['kind']='string';
  if(binary)kind='file';
  else if(binaryArray)kind='files';
  else if(type==='boolean')kind='boolean';
  else if(type==='number')kind='number';
  else if(type==='integer')kind='integer';
  else if(type==='object'||type==='array')kind='json';

  return {
    name,
    label:titleFromName(name),
    kind,
    required,
    description:typeof schema.description==='string'?schema.description:undefined,
    enumValues:Array.isArray(schema.enum)?schema.enum.filter((item):item is string=>typeof item==='string'):undefined,
    defaultValue:(typeof schema.default==='string'||typeof schema.default==='number'||typeof schema.default==='boolean')
      ?schema.default:undefined,
    location,
  };
}

function operationFields(document:JsonRecord,pathItem:JsonRecord,operation:JsonRecord):PdfProviderOperationField[]{
  const fields:PdfProviderOperationField[]=[];
  const params=[
    ...(Array.isArray(pathItem.parameters)?pathItem.parameters:[]),
    ...(Array.isArray(operation.parameters)?operation.parameters:[]),
  ];
  for(const raw of params){
    const parameter=resolveObject(document,raw);
    const name=typeof parameter.name==='string'?parameter.name:'';
    if(!name)continue;
    const location=parameter.in==='query'?'query':'form';
    fields.push(fieldFromSchema(document,name,parameter.schema,parameter.required===true,location));
  }

  const requestBody=resolveObject(document,operation.requestBody);
  if(Object.keys(requestBody).length){
    const requiredBody=requestBody.required===true;
    const content=isRecord(requestBody.content)?requestBody.content:{};
    const body=isRecord(content['multipart/form-data'])
      ?content['multipart/form-data']
      :isRecord(content['application/x-www-form-urlencoded'])
        ?content['application/x-www-form-urlencoded']
        :isRecord(content['application/json'])
          ?content['application/json']
          :undefined;
    if(isRecord(body)){
      const schema=resolveSchema(document,body.schema);
      const required=new Set(Array.isArray(schema.required)?schema.required.filter((item):item is string=>typeof item==='string'):[]);
      if(isRecord(schema.properties)){
        for(const [name,property] of Object.entries(schema.properties)){
          fields.push(fieldFromSchema(document,name,property,requiredBody||required.has(name),'form'));
        }
      }else{
        fields.push({
          name:'body',label:'Body',kind:'json',required:requiredBody,location:'form',
          description:'JSON request body',
        });
      }
    }
  }

  const seen=new Set<string>();
  return fields.filter((field)=>{
    const key=`${field.location}:${field.name}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}

export function parseStirlingOpenApi(document:unknown):PdfProviderOperation[]{
  if(!isRecord(document)||!isRecord(document.paths))return [];
  const operations:PdfProviderOperation[]=[];
  for(const [path,rawPathItem] of Object.entries(document.paths)){
    if(!path.startsWith('/api/v1/')||!isRecord(rawPathItem))continue;
    for(const method of ['get','post'] as const){
      const operation=rawPathItem[method];
      if(!isRecord(operation))continue;
      const operationId=typeof operation.operationId==='string'?operation.operationId:`${method}-${path}`;
      const summary=typeof operation.summary==='string'?operation.summary:titleFromName(operationId);
      const description=typeof operation.description==='string'?operation.description:'';
      const tags=Array.isArray(operation.tags)?operation.tags.filter((item):item is string=>typeof item==='string'):[];
      operations.push({
        id:operationId,
        path,
        method:method.toUpperCase() as 'GET'|'POST',
        summary,
        description,
        tags,
        fields:operationFields(document,rawPathItem,operation),
        category:categoryForOperation(operation,path),
      });
    }
  }
  return operations.sort((left,right)=>left.summary.localeCompare(right.summary));
}

interface NativeStirlingStatus{
  installed:boolean;
  running:boolean;
  java?:string|null;
  jarPath?:string|null;
  baseUrl:string;
  version?:string|null;
  message:string;
}

function normalizeStatus(status:NativeStirlingStatus):PdfProviderStatus{
  return {
    installed:status.installed,
    running:status.running,
    runtime:status.java,
    packagePath:status.jarPath,
    endpoint:status.baseUrl,
    version:status.version,
    message:status.message,
  };
}

export async function stirlingCoreStatus():Promise<PdfProviderStatus>{
  if(!isTauri())return {
    installed:false,running:false,endpoint:'http://127.0.0.1:28970',
    message:'The local PDF provider runs only inside the Windows/Tauri desktop runtime.',
  };
  return normalizeStatus(await invoke<NativeStirlingStatus>('stirling_core_status'));
}

export async function startStirlingCore():Promise<PdfProviderStatus>{
  if(!isTauri())throw new Error('The local PDF provider is available only in the Windows/Tauri desktop runtime.');
  return normalizeStatus(await invoke<NativeStirlingStatus>('stirling_core_start'));
}

export async function stopStirlingCore():Promise<boolean>{
  if(!isTauri())return false;
  return invoke<boolean>('stirling_core_stop');
}

export async function loadPdfProviderOperations():Promise<PdfProviderOperation[]>{
  if(!isTauri())return [];
  const document=await invoke<unknown>('stirling_core_openapi');
  return parseStirlingOpenApi(document);
}

export async function runPdfProviderOperation(
  operation:Pick<PdfProviderOperation,'path'|'method'>,
  fields:Array<{name:string;value:string}>,
  files:PdfProviderInputFile[],
):Promise<PdfProviderResponse>{
  if(!isTauri())throw new Error('Stirling provider-backed PDF tools are available only in the Windows/Tauri desktop runtime.');
  return invoke<PdfProviderResponse>('stirling_core_request',{
    method:operation.method,
    path:operation.path,
    fields,
    files,
  });
}

function extensionForContentType(contentType:string|undefined|null):string|undefined{
  const value=(contentType??'').toLowerCase();
  if(value.includes('application/pdf'))return 'pdf';
  if(value.includes('application/zip'))return 'zip';
  if(value.includes('image/png'))return 'png';
  if(value.includes('image/jpeg'))return 'jpg';
  if(value.includes('image/webp'))return 'webp';
  if(value.includes('image/tiff'))return 'tiff';
  if(value.includes('text/csv'))return 'csv';
  if(value.includes('application/json'))return 'json';
  if(value.includes('text/html'))return 'html';
  if(value.includes('text/markdown'))return 'md';
  if(value.includes('text/plain'))return 'txt';
  if(value.includes('wordprocessingml'))return 'docx';
  if(value.includes('spreadsheetml'))return 'xlsx';
  if(value.includes('presentationml'))return 'pptx';
  return undefined;
}

function filenameFromDisposition(disposition:string|undefined|null):string|undefined{
  if(!disposition)return undefined;
  const utf=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const raw=utf
    ?(()=>{try{return decodeURIComponent(utf.replace(/^["']|["']$/g,''));}catch{return utf;}})()
    :disposition.match(/filename="?([^";]+)"?/i)?.[1];
  if(!raw)return undefined;
  const basename=raw.replace(/\\/g,'/').split('/').at(-1)?.trim();
  if(!basename||basename==='.'||basename==='..')return undefined;
  return basename.replace(/[<>:"|?*\u0000-\u001F]/g,'_').slice(0,180);
}

function extensionFromMagic(bytes:number[]):string|undefined{
  if(bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-')return 'pdf';
  if(bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&(bytes[2]===0x03||bytes[2]===0x05||bytes[2]===0x07))return 'zip';
  if(bytes.length>=8&&bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')return 'png';
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpg';
  if(bytes.length>=4&&String.fromCharCode(...bytes.slice(0,4))==='RIFF')return 'webp';
  return undefined;
}

function outputFilename(response:PdfProviderResponse,fallbackBaseName:string):string{
  const disposition=filenameFromDisposition(response.contentDisposition);
  if(disposition)return disposition;
  const extension=extensionForContentType(response.contentType)??extensionFromMagic(response.bytes)??'bin';
  return `${fallbackBaseName}.${extension}`;
}

export function responseIsPdf(response:PdfProviderResponse):boolean{
  if((response.contentType??'').toLowerCase().includes('application/pdf'))return true;
  return response.bytes.length>=5&&String.fromCharCode(...response.bytes.slice(0,5))==='%PDF-';
}

export async function savePdfProviderResponse(
  response:PdfProviderResponse,
  fallbackBaseName='malenjo-pdf-tool-output',
):Promise<string|null>{
  const proposed=outputFilename(response,fallbackBaseName);
  const bytes=Uint8Array.from(response.bytes);

  if(!isTauri()){
    const blob=new Blob([bytes],{type:response.contentType??'application/octet-stream'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=proposed;
    anchor.click();
    URL.revokeObjectURL(url);
    return proposed;
  }

  const destination=await save({title:'Save PDF tool output',defaultPath:proposed});
  if(!destination)return null;
  await invoke<boolean>('write_pdf_tool_output',{destination,bytes:Array.from(bytes)});
  return destination;
}


export const stirlingCorePdfProvider:PdfToolProvider={
  id:'malenjo.pdf.local-core',
  contractVersion:PDF_PROVIDER_CONTRACT_VERSION,
  execution:'local-sidecar',
  autostart:false,
  reviewedToolCount:STIRLING_FRONTEND_TOOLS.length,
  status:stirlingCoreStatus,
  start:startStirlingCore,
  stop:stopStirlingCore,
  listOperations:loadStirlingOperations,
  run:runStirlingOperation,
  responseIsPdf,
  saveResponse:saveStirlingResponse,
};
