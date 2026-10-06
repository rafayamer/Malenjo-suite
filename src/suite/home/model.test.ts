import { describe, expect, it } from 'vitest';
import type { LibraryDocument } from '../files/types';
import {
  HOME_PRIMARY_ACTIONS,
  HOME_VISUAL_BASELINE,
  addPinnedLocation,
  defaultHomeState,
  groupRecentDocuments,
  homeDocumentsForView,
  matchesHomeFileFilter,
  pruneMissingStarredDocuments,
  recentGroupFor,
  sanitizeHomeState,
  toggleStarredDocument,
} from './model';
import { loadHomeState, saveHomeState } from './storage';

function document(id:string,name:string,lastOpenedMs:number|null,addedMs:number):LibraryDocument {
  return {
    id,name,extension:'pdf',kind:'pdf',sizeBytes:100,modifiedMs:addedMs,
    addedMs,lastOpenedMs,available:true,locationLabel:'C:\\Docs',
  };
}

function memoryStorage(initial:string|null=null) {
  let value=initial;
  return {
    getItem:()=>value,
    setItem:(_key:string,next:string)=>{ value=next; },
    value:()=>value,
  };
}

describe('Home module model',()=>{
  it('keeps the six-to-nine primary-action requirement with the pinned OSS visual contract',()=>{
    expect(HOME_PRIMARY_ACTIONS).toHaveLength(8);
    expect(HOME_PRIMARY_ACTIONS.map((action)=>action.id)).toEqual([
      'open','document','spreadsheet','presentation','pdf','scan','ocr','ai',
    ]);
    expect(HOME_VISUAL_BASELINE).toEqual({
      source:'CasualOffice/desktop',
      sourceCommit:'39fe70960462a9f16ea4f1e9aaa8b963d5da6ef1',
      license:'Apache-2.0',
      primaryActionCount:8,
      launcherPattern:'greeting + action cards + recent files + search + segmented filter + pinning',
      recentGroups:['Pinned','Today','Yesterday','Earlier this week','Earlier'],
      fileFilters:['all','pdf','documents','sheets','slides','images','other'],
      compactBreakpointPx:980,
    });
  });


  it('matches the CasualOffice recent-file filter pattern across MALENJO file types',()=>{
    const pdf=document('pdf','File.pdf',1,1);
    const docx={...document('doc','File.docx',1,1),kind:'docx' as const,extension:'docx'};
    const sheet={...document('sheet','File.xlsx',1,1),kind:'xlsx' as const,extension:'xlsx'};
    expect(matchesHomeFileFilter(pdf,'pdf')).toBe(true);
    expect(matchesHomeFileFilter(docx,'documents')).toBe(true);
    expect(matchesHomeFileFilter(sheet,'sheets')).toBe(true);
    expect(matchesHomeFileFilter(pdf,'documents')).toBe(false);
    expect(matchesHomeFileFilter(sheet,'all')).toBe(true);
  });

  it('groups recent files into the Office-style time buckets used by the OSS launcher',()=>{
    const now=new Date(2026,9,6,12,0,0).getTime();
    const today=now-60_000;
    const yesterday=now-25*60*60*1000;
    const week=now-3*24*60*60*1000;
    const old=now-20*24*60*60*1000;
    expect(recentGroupFor(today,now)).toBe('Today');
    expect(recentGroupFor(yesterday,now)).toBe('Yesterday');
    expect(recentGroupFor(week,now)).toBe('Earlier this week');
    expect(recentGroupFor(old,now)).toBe('Earlier');
    const groups=groupRecentDocuments([
      document('a','A.pdf',today,today),
      document('b','B.pdf',yesterday,yesterday),
      document('c','C.pdf',old,old),
    ],now);
    expect(groups.map((group)=>group.label)).toEqual(['Today','Yesterday','Earlier']);
  });

  it('sanitizes corrupted persistent state and deduplicates pinned locations',()=>{
    const state=sanitizeHomeState({
      schemaVersion:99,
      activeView:'bad',
      starredDocumentIds:['a','a',5,'b'],
      pinnedLocations:[
        {id:'x',label:'Docs',path:'C:\\Docs\\',addedAt:1},
        {id:'y',label:'Duplicate',path:'c:\\docs',addedAt:2},
        {id:'z',label:'',path:'D:\\Work',addedAt:'bad'},
      ],
    });
    expect(state.schemaVersion).toBe(1);
    expect(state.activeView).toBe('recent');
    expect(state.starredDocumentIds).toEqual(['a','b']);
    expect(state.pinnedLocations).toHaveLength(2);
    expect(state.pinnedLocations[1].label).toBe('Work');
  });

  it('sorts recent work, searches multiple terms and preserves starred order',()=>{
    const docs=[
      document('old','Old report.pdf',100,100),
      document('new','Quarterly report.pdf',300,300),
      document('added','Never opened.pdf',null,200),
    ];
    let state=defaultHomeState();
    state=toggleStarredDocument(state,'old');
    state=toggleStarredDocument(state,'new');

    expect(homeDocumentsForView(docs,state,'recent','').map((item)=>item.id)).toEqual(['new','added','old']);
    expect(homeDocumentsForView(docs,state,'recent','quarterly pdf').map((item)=>item.id)).toEqual(['new']);
    expect(homeDocumentsForView(docs,state,'starred','').map((item)=>item.id)).toEqual(['new','old']);
  });

  it('prunes removed starred documents but retains indexed unavailable entries',()=>{
    let state=defaultHomeState();
    state={...state,starredDocumentIds:['present','missing']};
    const docs=[{...document('present','Present.pdf',1,1),available:false}];
    expect(pruneMissingStarredDocuments(state,docs).starredDocumentIds).toEqual(['present']);
  });

  it('adds the newest pinned location first and replaces duplicate paths',()=>{
    const initial=addPinnedLocation(defaultHomeState(),{id:'a',label:'Docs',path:'C:\\Docs',addedAt:1});
    const next=addPinnedLocation(initial,{id:'b',label:'Docs renamed',path:'c:\\docs\\',addedAt:2});
    expect(next.pinnedLocations).toHaveLength(1);
    expect(next.pinnedLocations[0].id).toBe('b');
  });

  it('round-trips versioned Home state and recovers from malformed storage',()=>{
    const storage=memoryStorage();
    const state={...defaultHomeState(),activeView:'starred' as const,starredDocumentIds:['doc-1']};
    expect(saveHomeState(state,storage)).toEqual({ok:true});
    expect(loadHomeState(storage)).toEqual(state);

    const malformed=memoryStorage('{not json');
    expect(loadHomeState(malformed)).toEqual(defaultHomeState());
  });

  it('reports storage write failures instead of crashing the shell',()=>{
    const failing={setItem:()=>{throw new Error('quota denied');}};
    const result=saveHomeState(defaultHomeState(),failing);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('quota denied');
  });
});
