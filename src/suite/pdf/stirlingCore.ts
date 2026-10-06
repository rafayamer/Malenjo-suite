import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

export const STIRLING_OPEN_CORE_PIN='25220cbdbde2d526cebf173b94357884e180b8c1';

export type StirlingToolCategory=
  |'home'|'edit'|'convert'|'organize'|'comment'|'sign'|'protect'|'forms'|'scan'|'automate';

export interface StirlingFrontendTool {
  id:string;
  category:StirlingToolCategory;
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

export interface StirlingCoreStatus{
  installed:boolean;
  running:boolean;
  java?:string|null;
  jarPath?:string|null;
  baseUrl:string;
  version?:string|null;
  message:string;
}

export type StirlingFieldKind='string'|'boolean'|'number'|'integer'|'file'|'files'|'json';

export interface StirlingOperationField{
  name:string;
  label:string;
  kind:StirlingFieldKind;
  required:boolean;
  description?:string;
  enumValues?:string[];
  defaultValue?:string|number|boolean;
  location:'query'|'form';
}

export interface StirlingOperation{
  id:string;
  path:string;
  method:'GET'|'POST';
  summary:string;
  description:string;
  tags:string[];
  fields:StirlingOperationField[];
  category:StirlingToolCategory;
}

export interface StirlingInputFile{
  field:string;
  filename:string;
  contentType?:string;
  bytes:number[];
}

export interface StirlingResponse{
  status:number;
  contentType?:string|null;
  contentDisposition?:string|null;
  bytes:number[];
}

type JsonRecord=Record<string,unknown>;

function isRecord(value:unknown):value is JsonRecord{
  return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
}

function refName(ref:string):string{
  return ref.split('/').at(-1)??ref;
}

function mergeSchemas(parts:JsonRecord[]):JsonRecord{
  const properties:ObjectRecord={};
  const required=new Set<string>();
  let type:unknown;
  for(const part of parts){
    if(part.type!==undefined)type=part.type;
    if(isRecord(part.properties))Object.assign(properties,part.properties);
    if(Array.isArray(part.required))for(const item of part.required)if(typeof item==='string')required.add(item);
  }
  return {type,properties,required:[...required]};
}

type ObjectRecord=Record<string,unknown>;

function resolveSchema(document:JsonRecord,schema:unknown,depth=0):JsonRecord{
  if(depth>12||!isRecord(schema))return {};
  if(typeof schema.$ref==='string'){
    const name=refName(schema.$ref);
    const components=isRecord(document.components)?document.components:{};
    const schemas=isRecord(components.schemas)?components.schemas:{};
    return resolveSchema(document,schemas[name],depth+1);
  }
  if(Array.isArray(schema.allOf)){
    return mergeSchemas(schema.allOf.map((item)=>resolveSchema(document,item,depth+1)));
  }
  if(Array.isArray(schema.oneOf)&&schema.oneOf.length){
    return resolveSchema(document,schema.oneOf[0],depth+1);
  }
  if(Array.isArray(schema.anyOf)&&schema.anyOf.length){
    return resolveSchema(document,schema.anyOf[0],depth+1);
  }
  return schema;
}

function titleFromName(name:string):string{
  return name
    .replace(/([a-z0-9])([A-Z])/g,'$1 $2')
    .replace(/[-_]+/g,' ')
    .replace(/\bPdf\b/g,'PDF')
    .replace(/\bOcr\b/g,'OCR')
    .replace(/^./,(value)=>value.toUpperCase());
}

function categoryForOperation(operation:JsonRecord,path:string):StirlingToolCategory{
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
):StirlingOperationField{
  const schema=resolveSchema(document,raw);
  const type=typeof schema.type==='string'?schema.type:'string';
  const format=typeof schema.format==='string'?schema.format:'';
  const items=resolveSchema(document,schema.items);
  const binary=type==='string'&&format==='binary';
  const binaryArray=type==='array'&&items.type==='string'&&items.format==='binary';

  let kind:StirlingFieldKind='string';
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

function operationFields(document:JsonRecord,pathItem:JsonRecord,operation:JsonRecord):StirlingOperationField[]{
  const fields:StirlingOperationField[]=[];
  const params=[
    ...(Array.isArray(pathItem.parameters)?pathItem.parameters:[]),
    ...(Array.isArray(operation.parameters)?operation.parameters:[]),
  ];
  for(const raw of params){
    const parameter=resolveSchema(document,raw);
    const name=typeof parameter.name==='string'?parameter.name:'';
    if(!name)continue;
    const location=parameter.in==='query'?'query':'form';
    fields.push(fieldFromSchema(document,name,parameter.schema,parameter.required===true,location));
  }

  if(isRecord(operation.requestBody)){
    const requiredBody=operation.requestBody.required===true;
    const content=isRecord(operation.requestBody.content)?operation.requestBody.content:{};
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

export function parseStirlingOpenApi(document:unknown):StirlingOperation[]{
  if(!isRecord(document)||!isRecord(document.paths))return [];
  const operations:StirlingOperation[]=[];
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

export async function stirlingCoreStatus():Promise<StirlingCoreStatus>{
  if(!isTauri())return {
    installed:false,running:false,baseUrl:'http://127.0.0.1:28970',
    message:'The local Stirling core provider runs only inside the Windows/Tauri desktop runtime.',
  };
  return invoke<StirlingCoreStatus>('stirling_core_status');
}

export async function startStirlingCore():Promise<StirlingCoreStatus>{
  if(!isTauri())throw new Error('The local Stirling core provider is available only in the Windows/Tauri desktop runtime.');
  return invoke<StirlingCoreStatus>('stirling_core_start');
}

export async function stopStirlingCore():Promise<boolean>{
  if(!isTauri())return false;
  return invoke<boolean>('stirling_core_stop');
}

export async function loadStirlingOperations():Promise<StirlingOperation[]>{
  if(!isTauri())return [];
  const document=await invoke<unknown>('stirling_core_openapi');
  return parseStirlingOpenApi(document);
}

export async function runStirlingOperation(
  operation:Pick<StirlingOperation,'path'|'method'>,
  fields:Array<{name:string;value:string}>,
  files:StirlingInputFile[],
):Promise<StirlingResponse>{
  if(!isTauri())throw new Error('Stirling provider-backed PDF tools are available only in the Windows/Tauri desktop runtime.');
  return invoke<StirlingResponse>('stirling_core_request',{
    method:operation.method,
    path:operation.path,
    fields,
    files,
  });
}

function extensionForContentType(contentType:string|undefined|null):string{
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
  return 'bin';
}

function filenameFromDisposition(disposition:string|undefined|null):string|undefined{
  if(!disposition)return undefined;
  const utf=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if(utf){
    try{return decodeURIComponent(utf.replace(/^["']|["']$/g,''));}catch{return utf;}
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1];
}

export function responseIsPdf(response:StirlingResponse):boolean{
  if((response.contentType??'').toLowerCase().includes('application/pdf'))return true;
  return response.bytes.length>=5&&String.fromCharCode(...response.bytes.slice(0,5))==='%PDF-';
}

export async function saveStirlingResponse(
  response:StirlingResponse,
  fallbackBaseName='malenjo-pdf-tool-output',
):Promise<string|null>{
  const extension=extensionForContentType(response.contentType);
  const proposed=filenameFromDisposition(response.contentDisposition)
    ??`${fallbackBaseName}.${extension==='bin'?'zip':extension}`;
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
