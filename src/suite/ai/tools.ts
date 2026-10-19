export type AiToolRisk='read'|'write'|'destructive';

export type AiToolId=
  |'search_notebook'
  |'open_document_location'
  |'create_note'
  |'create_flashcards'
  |'create_quiz'
  |'compare_documents'
  |'export_summary'
  |'run_ocr';

export interface AiToolRequest{
  schemaVersion:1;
  tool:AiToolId;
  arguments:Record<string,unknown>;
  rationale:string;
}

export interface AiToolDefinition{
  id:AiToolId;
  risk:AiToolRisk;
  description:string;
  requiresConfirmation:boolean;
}

export interface AiToolAuthorizationContext{
  notebookId:string|null;
  allowedDocumentIds:Set<string>;
  userConfirmed:boolean;
}

export interface AiToolAuthorization{
  allowed:boolean;
  reason:string;
  request:AiToolRequest;
  definition:AiToolDefinition;
}

export const AI_TOOL_DEFINITIONS:readonly AiToolDefinition[]=[
  {id:'search_notebook',risk:'read',requiresConfirmation:false,description:'Search currently authorized notebook sources.'},
  {id:'open_document_location',risk:'read',requiresConfirmation:false,description:'Navigate to an authorized local document page/location.'},
  {id:'create_note',risk:'write',requiresConfirmation:true,description:'Create a persistent notebook note.'},
  {id:'create_flashcards',risk:'write',requiresConfirmation:true,description:'Create persistent notebook flashcards.'},
  {id:'create_quiz',risk:'write',requiresConfirmation:true,description:'Create a persistent notebook quiz.'},
  {id:'compare_documents',risk:'read',requiresConfirmation:false,description:'Compare authorized notebook documents.'},
  {id:'export_summary',risk:'write',requiresConfirmation:true,description:'Export a generated summary to a user-selected destination.'},
  {id:'run_ocr',risk:'write',requiresConfirmation:true,description:'Run the controlled MALENJO OCR workflow on an authorized document.'},
] as const;

const byId=new Map(AI_TOOL_DEFINITIONS.map((definition)=>[definition.id,definition]));

function clean(value:string,max:number):string{
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g,' ').trim().slice(0,max);
}

function requireString(args:Record<string,unknown>,key:string,max=500):string{
  const value=args[key];
  if(typeof value!=='string'||!clean(value,max))throw new Error(`Tool argument ${key} must be a non-empty string.`);
  return clean(value,max);
}

function optionalPage(args:Record<string,unknown>):void{
  if(args.page===undefined)return;
  if(!Number.isInteger(args.page)||(args.page as number)<1||(args.page as number)>100_000){
    throw new Error('Tool page must be an integer between 1 and 100000.');
  }
}

function documentId(args:Record<string,unknown>,key='documentId'):string{
  return requireString(args,key,220);
}

function validateArguments(tool:AiToolId,args:Record<string,unknown>):Record<string,unknown>{
  if(Object.values(args).some((value)=>typeof value==='string'&&/^(?:https?:\/\/|file:\/\/|[a-zA-Z]:\\|\/)/.test(value))){
    throw new Error('AI tool requests cannot contain raw URLs or filesystem paths.');
  }

  switch(tool){
    case 'search_notebook':
      return {query:requireString(args,'query',4_000)};
    case 'open_document_location':
      optionalPage(args);
      return {documentId:documentId(args),...(args.page===undefined?{}:{page:args.page})};
    case 'create_note':
      return {
        title:requireString(args,'title',200),
        body:requireString(args,'body',20_000),
        ...(args.documentId===undefined?{}:{documentId:documentId(args)}),
      };
    case 'create_flashcards':
      return {topic:requireString(args,'topic',500),count:Math.max(1,Math.min(50,Number(args.count)||10))};
    case 'create_quiz':
      return {topic:requireString(args,'topic',500),count:Math.max(1,Math.min(50,Number(args.count)||10))};
    case 'compare_documents':{
      const ids=args.documentIds;
      if(!Array.isArray(ids)||ids.length<2||ids.length>20||ids.some((id)=>typeof id!=='string'||!clean(id,220))){
        throw new Error('compare_documents requires 2..20 document IDs.');
      }
      return {documentIds:Array.from(new Set(ids.map((id)=>clean(String(id),220))))};
    }
    case 'export_summary':
      return {title:requireString(args,'title',240),format:['txt','md','docx'].includes(String(args.format))?String(args.format):'md'};
    case 'run_ocr':
      optionalPage(args);
      return {documentId:documentId(args),...(args.page===undefined?{}:{page:args.page})};
  }
}

export function parseAiToolRequest(value:unknown):AiToolRequest{
  if(!value||typeof value!=='object')throw new Error('AI tool request must be an object.');
  const input=value as Partial<AiToolRequest>;
  if(input.schemaVersion!==1)throw new Error('Unsupported AI tool request schema.');
  if(typeof input.tool!=='string'||!byId.has(input.tool as AiToolId))throw new Error('Unknown or unapproved AI tool.');
  if(!input.arguments||typeof input.arguments!=='object'||Array.isArray(input.arguments))throw new Error('AI tool arguments must be an object.');
  return {
    schemaVersion:1,
    tool:input.tool as AiToolId,
    arguments:validateArguments(input.tool as AiToolId,input.arguments as Record<string,unknown>),
    rationale:typeof input.rationale==='string'?clean(input.rationale,1_000):'',
  };
}

function requestedDocumentIds(request:AiToolRequest):string[]{
  const args=request.arguments;
  if(typeof args.documentId==='string')return [args.documentId];
  if(Array.isArray(args.documentIds))return args.documentIds.filter((id):id is string=>typeof id==='string');
  return [];
}

export function authorizeAiToolRequest(
  raw:unknown,
  context:AiToolAuthorizationContext,
):AiToolAuthorization{
  const request=parseAiToolRequest(raw);
  const definition=byId.get(request.tool)!;

  if(['search_notebook','create_note','create_flashcards','create_quiz','compare_documents'].includes(request.tool)&&!context.notebookId){
    return {allowed:false,reason:'This tool requires an active notebook.',request,definition};
  }

  for(const id of requestedDocumentIds(request)){
    if(!context.allowedDocumentIds.has(id)){
      return {allowed:false,reason:'The requested document is outside the AI-authorized source set.',request,definition};
    }
  }

  if(definition.requiresConfirmation&&!context.userConfirmed){
    return {allowed:false,reason:'User confirmation is required before this tool can change or export data.',request,definition};
  }

  return {allowed:true,reason:'Tool request is within the controlled MALENJO AI boundary.',request,definition};
}

export function aiToolPromptContract():string{
  return [
    'AVAILABLE MALENJO TOOLS:',
    ...AI_TOOL_DEFINITIONS.map((definition)=>
      `- ${definition.id}: ${definition.description} risk=${definition.risk} confirmation=${definition.requiresConfirmation?'required':'not-required'}`,
    ),
    'If a tool is needed, return a separate structured tool request using schemaVersion=1. Never invent tool names, raw URLs, filesystem paths, shell commands, or network endpoints.',
  ].join('\n');
}
