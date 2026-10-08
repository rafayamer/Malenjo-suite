import { describe, expect, it } from 'vitest';
import type { LibraryDocument } from '../files/types';
import {
  addAiNotebookNote,
  createAiNotebook,
  enabledAiNotebookSourceIds,
  recordAiNotebookStudyResult,
  removeAiNotebookSource,
  setAiNotebookSourceEnabled,
  syncAiNotebookOpenDocuments,
  updateAiNotebookConversationSummary,
  validateAiNotebook,
} from './notebook';

function document(id:string,name:string,kind:LibraryDocument['kind']='pdf'):LibraryDocument{
  return {
    id,name,kind,extension:name.split('.').pop()??'',sizeBytes:100,
    modifiedMs:1,addedMs:1,lastOpenedMs:1,available:true,locationLabel:'test',
  };
}

describe('AI notebook core',()=>{
  it('creates and validates a bounded notebook',()=>{
    const notebook=createAiNotebook(' Power Systems ',100);
    expect(notebook.title).toBe('Power Systems');
    expect(validateAiNotebook(notebook)).toEqual(notebook);
  });

  it('adds supported open documents once and preserves explicit source state',()=>{
    let notebook=createAiNotebook('Study',100);
    notebook=syncAiNotebookOpenDocuments(notebook,[
      document('a','A.pdf'),
      document('b','B.docx','docx'),
      document('image','photo.png','image'),
      document('a','A.pdf'),
    ],200);
    expect(notebook.sources.map((source)=>source.documentId)).toEqual(['a','b']);

    notebook=setAiNotebookSourceEnabled(notebook,'b',false,300);
    expect(enabledAiNotebookSourceIds(notebook)).toEqual(new Set(['a']));
    expect(syncAiNotebookOpenDocuments(notebook,[document('b','B.docx','docx')],400).sources[1]?.enabled).toBe(false);
  });

  it('keeps notes linked only to notebook sources and removes stale links',()=>{
    let notebook=syncAiNotebookOpenDocuments(createAiNotebook('Study',100),[
      document('a','A.pdf'),document('b','B.pdf'),
    ],200);
    notebook=addAiNotebookNote(notebook,{
      title:'Key idea',
      body:'Differential protection compares currents.',
      sourceDocumentIds:['a','missing','b','a'],
    },300);
    expect(notebook.notes[0]?.sourceDocumentIds).toEqual(['a','b']);

    notebook=removeAiNotebookSource(notebook,'a',400);
    expect(notebook.notes[0]?.sourceDocumentIds).toEqual(['b']);
  });

  it('tracks study performance without unbounded mastery values',()=>{
    let notebook=createAiNotebook('Study',100);
    notebook=recordAiNotebookStudyResult(notebook,'Protection',true,200);
    notebook=recordAiNotebookStudyResult(notebook,'protection',false,300);
    expect(notebook.study).toHaveLength(1);
    expect(notebook.study[0]?.attempts).toBe(2);
    expect(notebook.study[0]?.correct).toBe(1);
    expect(notebook.study[0]?.mastery).toBeGreaterThanOrEqual(0);
    expect(notebook.study[0]?.mastery).toBeLessThanOrEqual(1);
  });

  it('bounds persistent conversation summary text',()=>{
    const notebook=updateAiNotebookConversationSummary(createAiNotebook('Study',100),'x'.repeat(30_000),200);
    expect(notebook.conversationSummary.length).toBe(24_000);
  });
});
