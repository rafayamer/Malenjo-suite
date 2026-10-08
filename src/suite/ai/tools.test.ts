import { describe, expect, it } from 'vitest';
import { aiToolPromptContract, authorizeAiToolRequest, parseAiToolRequest } from './tools';

describe('controlled MALENJO AI tool contract',()=>{
  const context={
    notebookId:'notebook-1',
    allowedDocumentIds:new Set(['doc-1','doc-2']),
    userConfirmed:false,
  };

  it('allows read-only navigation within authorized documents',()=>{
    const result=authorizeAiToolRequest({
      schemaVersion:1,
      tool:'open_document_location',
      arguments:{documentId:'doc-1',page:12},
      rationale:'Open the cited page.',
    },context);
    expect(result.allowed).toBe(true);
  });

  it('blocks write tools until the user confirms them',()=>{
    const raw={
      schemaVersion:1,
      tool:'create_note',
      arguments:{title:'Relay note',body:'Buchholz relays detect gas.'},
      rationale:'Save the learner note.',
    };
    expect(authorizeAiToolRequest(raw,context).allowed).toBe(false);
    expect(authorizeAiToolRequest(raw,{...context,userConfirmed:true}).allowed).toBe(true);
  });

  it('blocks documents outside the authorized notebook source set',()=>{
    const result=authorizeAiToolRequest({
      schemaVersion:1,
      tool:'run_ocr',
      arguments:{documentId:'secret-doc',page:1},
      rationale:'Read scan.',
    },{...context,userConfirmed:true});
    expect(result.allowed).toBe(false);
  });

  it('rejects unknown tools, paths and URLs rather than passing them through',()=>{
    expect(()=>parseAiToolRequest({
      schemaVersion:1,tool:'shell',arguments:{command:'rm -rf /'},rationale:'',
    })).toThrow(/unknown/i);
    expect(()=>parseAiToolRequest({
      schemaVersion:1,tool:'export_summary',arguments:{title:'/etc/passwd',format:'md'},rationale:'',
    })).toThrow(/filesystem paths/i);
    expect(()=>parseAiToolRequest({
      schemaVersion:1,tool:'create_note',arguments:{title:'x',body:'https://example.com'},rationale:'',
    })).toThrow(/raw urls/i);
  });

  it('publishes a fixed prompt contract instead of arbitrary tool execution',()=>{
    const contract=aiToolPromptContract();
    expect(contract).toContain('AVAILABLE MALENJO TOOLS');
    expect(contract).toContain('Never invent tool names');
    expect(contract).not.toContain('shell');
  });
});
