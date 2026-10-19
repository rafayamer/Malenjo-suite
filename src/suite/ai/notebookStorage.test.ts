import { describe, expect, it } from 'vitest';
import { createAiNotebook } from './notebook';
import {
  deleteAiNotebook,
  listAiNotebooks,
  loadAiNotebook,
  saveAiNotebook,
  type AiNotebookStorage,
} from './notebookStorage';

class MemoryStorage implements AiNotebookStorage{
  protected data=new Map<string,string>();
  getItem(key:string){return this.data.get(key)??null;}
  setItem(key:string,value:string){this.data.set(key,value);}
  removeItem(key:string){this.data.delete(key);}
}

describe('AI notebook local persistence',()=>{
  it('saves, loads, lists and deletes notebooks',()=>{
    const storage=new MemoryStorage();
    const first=createAiNotebook('First',100);
    const second=createAiNotebook('Second',200);
    saveAiNotebook(storage,first);
    saveAiNotebook(storage,second);

    expect(loadAiNotebook(storage,first.id)?.title).toBe('First');
    expect(listAiNotebooks(storage).map((item)=>item.title)).toEqual(['Second','First']);
    expect(deleteAiNotebook(storage,second.id)).toBe(true);
    expect(loadAiNotebook(storage,second.id)).toBeNull();
  });

  it('rejects oversized restored notebook JSON before parsing it',()=>{
    const storage=new MemoryStorage();
    const notebook=createAiNotebook('Stored',100);
    storage.setItem('malenjo.ai.notebook.v1.'+notebook.id,'x'.repeat(2_000_001));
    expect(()=>loadAiNotebook(storage,notebook.id)).toThrow(/exceeds/i);
  });

  it('rolls back the notebook value when index persistence fails',()=>{
    class FailingIndexStorage extends MemoryStorage{
      setItem(key:string,value:string){
        if(key==='malenjo.ai.notebooks.index.v1')throw new Error('quota');
        super.setItem(key,value);
      }
    }
    const storage=new FailingIndexStorage();
    const notebook=createAiNotebook('Rollback',100);
    expect(()=>saveAiNotebook(storage,notebook)).toThrow(/quota/);
    expect(loadAiNotebook(storage,notebook.id)).toBeNull();
  });

  it('refuses oversized notebook payloads',()=>{
    const storage=new MemoryStorage();
    const notebook=createAiNotebook('Large',100);
    notebook.conversationSummary='x'.repeat(2_100_000);
    expect(()=>saveAiNotebook(storage,notebook)).toThrow();
  });

  it('prunes corrupt notebook entries instead of returning guessed data',()=>{
    const storage=new MemoryStorage();
    const notebook=createAiNotebook('Good',100);
    saveAiNotebook(storage,notebook);
    storage.setItem('malenjo.ai.notebook.v1.bad','{broken');
    storage.setItem('malenjo.ai.notebooks.index.v1',JSON.stringify(['bad',notebook.id]));
    expect(listAiNotebooks(storage).map((item)=>item.id)).toEqual([notebook.id]);
  });
});
