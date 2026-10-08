import type { LibraryDocument, LibraryDocumentKind } from '../files/types';

export const AI_NOTEBOOK_SCHEMA_VERSION=1;
export const AI_NOTEBOOK_LIMITS={
  maxTitleChars:160,
  maxSources:200,
  maxNotes:1000,
  maxNoteTitleChars:200,
  maxNoteBodyChars:20_000,
  maxStudyTopics:500,
  maxConversationSummaryChars:24_000,
} as const;

export interface AiNotebookSourceRef{
  documentId:string;
  name:string;
  kind:LibraryDocumentKind;
  addedAt:number;
  enabled:boolean;
}

export interface AiNotebookNote{
  id:string;
  title:string;
  body:string;
  sourceDocumentIds:string[];
  createdAt:number;
  updatedAt:number;
}

export interface AiNotebookStudyProgress{
  topic:string;
  mastery:number;
  attempts:number;
  correct:number;
  lastReviewedAt:number|null;
}

export interface AiNotebook{
  schemaVersion:1;
  id:string;
  title:string;
  createdAt:number;
  updatedAt:number;
  sources:AiNotebookSourceRef[];
  notes:AiNotebookNote[];
  study:AiNotebookStudyProgress[];
  conversationSummary:string;
}

function cleanText(value:string,max:number):string{
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,' ')
    .trim()
    .slice(0,max);
}

function id(prefix:string,now:number):string{
  return `${prefix}-${now.toString(36)}-${Math.random().toString(36).slice(2,9)}`;
}

function boundedInt(value:number,min:number,max:number):number{
  if(!Number.isFinite(value))return min;
  return Math.max(min,Math.min(max,Math.floor(value)));
}

export function createAiNotebook(title:string,now=Date.now()):AiNotebook{
  const clean=cleanText(title,AI_NOTEBOOK_LIMITS.maxTitleChars);
  if(!clean)throw new Error('Notebook title is required.');
  return {
    schemaVersion:AI_NOTEBOOK_SCHEMA_VERSION,
    id:id('notebook',now),
    title:clean,
    createdAt:now,
    updatedAt:now,
    sources:[],
    notes:[],
    study:[],
    conversationSummary:'',
  };
}

export function validateAiNotebook(value:unknown):AiNotebook{
  if(!value||typeof value!=='object')throw new Error('Notebook data must be an object.');
  const input=value as Partial<AiNotebook>;
  if(input.schemaVersion!==AI_NOTEBOOK_SCHEMA_VERSION)throw new Error('Unsupported notebook schema version.');
  if(typeof input.id!=='string'||!input.id)throw new Error('Notebook ID is required.');
  if(typeof input.title!=='string'||!cleanText(input.title,AI_NOTEBOOK_LIMITS.maxTitleChars))throw new Error('Notebook title is required.');
  if(!Number.isFinite(input.createdAt)||!Number.isFinite(input.updatedAt))throw new Error('Notebook timestamps are invalid.');
  if(!Array.isArray(input.sources)||input.sources.length>AI_NOTEBOOK_LIMITS.maxSources)throw new Error('Notebook source list is invalid.');
  if(!Array.isArray(input.notes)||input.notes.length>AI_NOTEBOOK_LIMITS.maxNotes)throw new Error('Notebook note list is invalid.');
  if(!Array.isArray(input.study)||input.study.length>AI_NOTEBOOK_LIMITS.maxStudyTopics)throw new Error('Notebook study progress is invalid.');
  if(typeof input.conversationSummary!=='string'||input.conversationSummary.length>AI_NOTEBOOK_LIMITS.maxConversationSummaryChars){
    throw new Error('Notebook conversation summary is invalid.');
  }

  const sourceIds=new Set<string>();
  const sources=input.sources.map((source)=>{
    if(!source||typeof source!=='object')throw new Error('Notebook source entry is invalid.');
    const item=source as AiNotebookSourceRef;
    if(!item.documentId||sourceIds.has(item.documentId))throw new Error('Notebook source IDs must be unique.');
    if(!item.name||!Number.isFinite(item.addedAt)||typeof item.enabled!=='boolean')throw new Error('Notebook source entry is incomplete.');
    sourceIds.add(item.documentId);
    return {
      documentId:item.documentId,
      name:cleanText(item.name,260),
      kind:item.kind,
      addedAt:item.addedAt,
      enabled:item.enabled,
    };
  });

  const noteIds=new Set<string>();
  const notes=input.notes.map((note)=>{
    if(!note||typeof note!=='object')throw new Error('Notebook note entry is invalid.');
    const item=note as AiNotebookNote;
    if(!item.id||noteIds.has(item.id))throw new Error('Notebook note IDs must be unique.');
    if(!Number.isFinite(item.createdAt)||!Number.isFinite(item.updatedAt))throw new Error('Notebook note timestamps are invalid.');
    noteIds.add(item.id);
    return {
      id:item.id,
      title:cleanText(item.title,AI_NOTEBOOK_LIMITS.maxNoteTitleChars),
      body:cleanText(item.body,AI_NOTEBOOK_LIMITS.maxNoteBodyChars),
      sourceDocumentIds:Array.from(new Set((item.sourceDocumentIds??[]).filter((sourceId)=>sourceIds.has(sourceId)))).slice(0,AI_NOTEBOOK_LIMITS.maxSources),
      createdAt:item.createdAt,
      updatedAt:item.updatedAt,
    };
  });

  const study=input.study.map((entry)=>{
    if(!entry||typeof entry!=='object')throw new Error('Notebook study entry is invalid.');
    const item=entry as AiNotebookStudyProgress;
    const topic=cleanText(item.topic,240);
    if(!topic)throw new Error('Notebook study topic is required.');
    return {
      topic,
      mastery:Math.max(0,Math.min(1,Number(item.mastery)||0)),
      attempts:boundedInt(item.attempts,0,1_000_000),
      correct:boundedInt(item.correct,0,1_000_000),
      lastReviewedAt:item.lastReviewedAt===null?null:(Number.isFinite(item.lastReviewedAt)?item.lastReviewedAt:null),
    };
  });

  return {
    schemaVersion:AI_NOTEBOOK_SCHEMA_VERSION,
    id:input.id,
    title:cleanText(input.title,AI_NOTEBOOK_LIMITS.maxTitleChars),
    createdAt:input.createdAt!,
    updatedAt:input.updatedAt!,
    sources,
    notes,
    study,
    conversationSummary:cleanText(input.conversationSummary,AI_NOTEBOOK_LIMITS.maxConversationSummaryChars),
  };
}

export function renameAiNotebook(notebook:AiNotebook,title:string,now=Date.now()):AiNotebook{
  const clean=cleanText(title,AI_NOTEBOOK_LIMITS.maxTitleChars);
  if(!clean)throw new Error('Notebook title is required.');
  return {...notebook,title:clean,updatedAt:now};
}

export function syncAiNotebookOpenDocuments(
  notebook:AiNotebook,
  documents:LibraryDocument[],
  now=Date.now(),
):AiNotebook{
  const supported=new Set<LibraryDocumentKind>(['pdf','docx','xlsx','pptx']);
  const byId=new Map(notebook.sources.map((source)=>[source.documentId,source]));
  const next=[...notebook.sources];

  for(const document of documents){
    if(!supported.has(document.kind)||byId.has(document.id))continue;
    if(next.length>=AI_NOTEBOOK_LIMITS.maxSources)break;
    const source:AiNotebookSourceRef={
      documentId:document.id,
      name:cleanText(document.name,260),
      kind:document.kind,
      addedAt:now,
      enabled:true,
    };
    next.push(source);
    byId.set(document.id,source);
  }

  return next.length===notebook.sources.length
    ? notebook
    : {...notebook,sources:next,updatedAt:now};
}

export function setAiNotebookSourceEnabled(
  notebook:AiNotebook,
  documentId:string,
  enabled:boolean,
  now=Date.now(),
):AiNotebook{
  let changed=false;
  const sources=notebook.sources.map((source)=>{
    if(source.documentId!==documentId||source.enabled===enabled)return source;
    changed=true;
    return {...source,enabled};
  });
  return changed?{...notebook,sources,updatedAt:now}:notebook;
}

export function removeAiNotebookSource(notebook:AiNotebook,documentId:string,now=Date.now()):AiNotebook{
  const sources=notebook.sources.filter((source)=>source.documentId!==documentId);
  if(sources.length===notebook.sources.length)return notebook;
  const notes=notebook.notes.map((note)=>({
    ...note,
    sourceDocumentIds:note.sourceDocumentIds.filter((id)=>id!==documentId),
  }));
  return {...notebook,sources,notes,updatedAt:now};
}

export function addAiNotebookNote(
  notebook:AiNotebook,
  input:{title:string;body:string;sourceDocumentIds?:string[]},
  now=Date.now(),
):AiNotebook{
  if(notebook.notes.length>=AI_NOTEBOOK_LIMITS.maxNotes)throw new Error('Notebook note limit reached.');
  const sourceIds=new Set(notebook.sources.map((source)=>source.documentId));
  const note:AiNotebookNote={
    id:id('note',now),
    title:cleanText(input.title,AI_NOTEBOOK_LIMITS.maxNoteTitleChars),
    body:cleanText(input.body,AI_NOTEBOOK_LIMITS.maxNoteBodyChars),
    sourceDocumentIds:Array.from(new Set(input.sourceDocumentIds??[])).filter((sourceId)=>sourceIds.has(sourceId)),
    createdAt:now,
    updatedAt:now,
  };
  if(!note.title&&!note.body)throw new Error('Notebook note needs a title or body.');
  return {...notebook,notes:[...notebook.notes,note],updatedAt:now};
}

export function updateAiNotebookConversationSummary(
  notebook:AiNotebook,
  summary:string,
  now=Date.now(),
):AiNotebook{
  return {
    ...notebook,
    conversationSummary:cleanText(summary,AI_NOTEBOOK_LIMITS.maxConversationSummaryChars),
    updatedAt:now,
  };
}

export function recordAiNotebookStudyResult(
  notebook:AiNotebook,
  topic:string,
  correct:boolean,
  now=Date.now(),
):AiNotebook{
  const cleanTopic=cleanText(topic,240);
  if(!cleanTopic)throw new Error('Study topic is required.');
  const key=cleanTopic.toLocaleLowerCase();
  const index=notebook.study.findIndex((entry)=>entry.topic.toLocaleLowerCase()===key);
  const previous=index>=0?notebook.study[index]:null;
  if(!previous&&notebook.study.length>=AI_NOTEBOOK_LIMITS.maxStudyTopics)throw new Error('Notebook study-topic limit reached.');

  const attempts=(previous?.attempts??0)+1;
  const correctCount=(previous?.correct??0)+(correct?1:0);
  const observed=correctCount/attempts;
  const mastery=Math.round(((previous?.mastery??0)*0.6+observed*0.4)*1000)/1000;
  const next:AiNotebookStudyProgress={
    topic:previous?.topic??cleanTopic,
    mastery,
    attempts,
    correct:correctCount,
    lastReviewedAt:now,
  };
  const study=index>=0
    ? notebook.study.map((entry,position)=>position===index?next:entry)
    : [...notebook.study,next];
  return {...notebook,study,updatedAt:now};
}

export function enabledAiNotebookSourceIds(notebook:AiNotebook):Set<string>{
  return new Set(notebook.sources.filter((source)=>source.enabled).map((source)=>source.documentId));
}
