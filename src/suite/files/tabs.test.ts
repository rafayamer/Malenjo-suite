import { describe, expect, it } from 'vitest';
import type { LibraryDocument } from './types';
import {
  activateDocumentTab,
  closeDocumentTab,
  cycleDocumentTab,
  emptyDocumentTabs,
  openDocumentTab,
} from './tabs';

function document(id:string,name:string):LibraryDocument {
  return {
    id,
    name,
    extension:'pdf',
    kind:'pdf',
    sizeBytes:100,
    modifiedMs:1,
    addedMs:1,
    lastOpenedMs:1,
    available:true,
    locationLabel:'test',
  };
}

describe('source-truth document tabs',()=>{
  it('keeps multiple documents open and activates the latest',()=>{
    let state=openDocumentTab(emptyDocumentTabs,document('a','A.pdf'));
    state=openDocumentTab(state,document('b','B.pdf'));
    expect(state.sessions.map((item)=>item.document.id)).toEqual(['a','b']);
    expect(state.activeSessionId).toBe('session:b');
  });

  it('does not duplicate the same library document',()=>{
    let state=openDocumentTab(emptyDocumentTabs,document('a','A.pdf'));
    state=openDocumentTab(state,document('a','A.pdf'));
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe('session:a');
  });

  it('closing the active tab selects a neighboring document',()=>{
    let state=openDocumentTab(emptyDocumentTabs,document('a','A.pdf'));
    state=openDocumentTab(state,document('b','B.pdf'));
    state=openDocumentTab(state,document('c','C.pdf'));
    state=activateDocumentTab(state,'session:b');
    state=closeDocumentTab(state,'session:b');
    expect(state.sessions.map((item)=>item.document.id)).toEqual(['a','c']);
    expect(state.activeSessionId).toBe('session:c');
  });

  it('cycles forward and backward like professional tabbed editors',()=>{
    let state=openDocumentTab(emptyDocumentTabs,document('a','A.pdf'));
    state=openDocumentTab(state,document('b','B.pdf'));
    state=openDocumentTab(state,document('c','C.pdf'));
    state=cycleDocumentTab(state,1);
    expect(state.activeSessionId).toBe('session:a');
    state=cycleDocumentTab(state,-1);
    expect(state.activeSessionId).toBe('session:c');
  });
});
