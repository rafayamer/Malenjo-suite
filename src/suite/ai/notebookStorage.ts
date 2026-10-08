import { validateAiNotebook, type AiNotebook } from './notebook';

export interface AiNotebookStorage{
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
}

const INDEX_KEY='malenjo.ai.notebooks.index.v1';
const NOTEBOOK_PREFIX='malenjo.ai.notebook.v1.';
const MAX_NOTEBOOK_BYTES=2_000_000;
const MAX_NOTEBOOKS=100;

function byteLength(value:string):number{
  return new TextEncoder().encode(value).byteLength;
}

function notebookKey(id:string):string{
  return `${NOTEBOOK_PREFIX}${id}`;
}

function parseIndex(storage:AiNotebookStorage):string[]{
  const raw=storage.getItem(INDEX_KEY);
  if(!raw)return [];
  try{
    const value=JSON.parse(raw);
    if(!Array.isArray(value))return [];
    return value.filter((id):id is string=>typeof id==='string'&&id.length>0).slice(0,MAX_NOTEBOOKS);
  }catch{
    return [];
  }
}

function writeIndex(storage:AiNotebookStorage,ids:string[]):void{
  storage.setItem(INDEX_KEY,JSON.stringify(Array.from(new Set(ids)).slice(0,MAX_NOTEBOOKS)));
}

export function saveAiNotebook(storage:AiNotebookStorage,notebook:AiNotebook):void{
  const valid=validateAiNotebook(notebook);
  const serialized=JSON.stringify(valid);
  if(byteLength(serialized)>MAX_NOTEBOOK_BYTES)throw new Error('Notebook exceeds the 2 MB local persistence limit.');

  const ids=parseIndex(storage);
  if(!ids.includes(valid.id)&&ids.length>=MAX_NOTEBOOKS)throw new Error('Notebook count limit reached.');
  storage.setItem(notebookKey(valid.id),serialized);
  writeIndex(storage,[valid.id,...ids.filter((id)=>id!==valid.id)]);
}

export function loadAiNotebook(storage:AiNotebookStorage,id:string):AiNotebook|null{
  const raw=storage.getItem(notebookKey(id));
  if(!raw)return null;
  return validateAiNotebook(JSON.parse(raw));
}

export function listAiNotebooks(storage:AiNotebookStorage):AiNotebook[]{
  const results:AiNotebook[]=[];
  const validIds:string[]=[];
  for(const id of parseIndex(storage)){
    try{
      const notebook=loadAiNotebook(storage,id);
      if(notebook){
        results.push(notebook);
        validIds.push(id);
      }
    }catch{
      // Corrupt entries are ignored and pruned from the index.
    }
  }
  if(validIds.length!==parseIndex(storage).length)writeIndex(storage,validIds);
  return results.sort((a,b)=>b.updatedAt-a.updatedAt);
}

export function deleteAiNotebook(storage:AiNotebookStorage,id:string):boolean{
  const existed=storage.getItem(notebookKey(id))!==null;
  storage.removeItem(notebookKey(id));
  writeIndex(storage,parseIndex(storage).filter((item)=>item!==id));
  return existed;
}
