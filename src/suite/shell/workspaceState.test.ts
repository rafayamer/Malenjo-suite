import { describe, expect, it } from 'vitest';
import { createDocumentSession } from '../files/session';
import type { LibraryDocument } from '../files/types';
import { buildWorkspaceState, parseWorkspaceState } from './workspaceState';

function document(id:string, ephemeral=false):LibraryDocument {
  return {
    id,
    name:`${id}.pdf`,
    extension:'pdf',
    kind:'pdf',
    sizeBytes:1,
    modifiedMs:1,
    addedMs:1,
    lastOpenedMs:null,
    available:true,
    locationLabel:ephemeral?'Browser session':'Documents',
    ephemeral,
    ...(ephemeral ? { browserFile:new File(['x'],`${id}.pdf`) } : {}),
  };
}

describe('workspace session persistence',()=>{
  it('persists native library tabs but never browser-session file objects',()=>{
    const native=createDocumentSession(document('native'),100);
    const browser=createDocumentSession(document('browser',true),200);
    const state=buildWorkspaceState([native,browser],native.id);

    expect(state.nativeDocumentIds).toEqual(['native']);
    expect(state.activeDocumentId).toBe('native');
  });

  it('does not persist an ephemeral active document as the restore target',()=>{
    const native=createDocumentSession(document('native'),100);
    const browser=createDocumentSession(document('browser',true),200);
    const state=buildWorkspaceState([native,browser],browser.id);

    expect(state.nativeDocumentIds).toEqual(['native']);
    expect(state.activeDocumentId).toBeNull();
  });

  it('rejects malformed and unknown-version state',()=>{
    expect(parseWorkspaceState('{')).toEqual({version:1,nativeDocumentIds:[],activeDocumentId:null});
    expect(parseWorkspaceState(JSON.stringify({version:2,nativeDocumentIds:['x']})))
      .toEqual({version:1,nativeDocumentIds:[],activeDocumentId:null});
  });

  it('deduplicates and bounds native IDs',()=>{
    const parsed=parseWorkspaceState(JSON.stringify({
      version:1,
      nativeDocumentIds:['a','a',' ','b'],
      activeDocumentId:'b',
    }));
    expect(parsed.nativeDocumentIds).toEqual(['a','b']);
    expect(parsed.activeDocumentId).toBe('b');
  });
});
