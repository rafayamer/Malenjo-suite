import { describe, expect, it } from 'vitest';
import { createDocumentSession, setDocumentPinned } from './session';
import {
  parseSessionState, resolveRestorableDocuments, serializeSessionState,
} from './sessionPersistence';
import type { LibraryDocument } from './types';

const document: LibraryDocument = {
  id:'doc-1',name:'one.pdf',extension:'pdf',kind:'pdf',sizeBytes:1,modifiedMs:1,addedMs:1,
  lastOpenedMs:null,available:true,locationLabel:'Desktop',
};

describe('desktop session restoration',()=>{
  it('serializes only persistent desktop sessions and active persistent document',()=>{
    const persistent=setDocumentPinned(createDocumentSession(document,10),true);
    const ephemeral=createDocumentSession({
      ...document,id:'browser-1',name:'browser.pdf',ephemeral:true,
      browserFile:new File(['x'],'browser.pdf',{type:'application/pdf'}),
    },20);
    const state=serializeSessionState([persistent,ephemeral],persistent.id);
    expect(state.sessions).toEqual([{documentId:'doc-1',pinned:true}]);
    expect(state.activeDocumentId).toBe('doc-1');
  });

  it('rejects malformed state and de-duplicates persisted ids',()=>{
    expect(parseSessionState('{bad')).toEqual({version:1,sessions:[],activeDocumentId:null});
    const state=parseSessionState(JSON.stringify({
      version:1,
      sessions:[
        {documentId:'doc-1',pinned:true},
        {documentId:'doc-1',pinned:false},
      ],
      activeDocumentId:'doc-1',
    }));
    expect(state.sessions).toEqual([{documentId:'doc-1',pinned:true}]);
  });

  it('restores only currently available library documents',()=>{
    const state={version:1 as const,sessions:[{documentId:'doc-1',pinned:true},{documentId:'missing',pinned:false}],activeDocumentId:'doc-1'};
    const resolved=resolveRestorableDocuments(state,[document]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.document.id).toBe('doc-1');
    expect(resolved[0]?.pinned).toBe(true);
  });
});
