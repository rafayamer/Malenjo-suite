import {describe,expect,it} from 'vitest';
import {finishPdfInstallCommit} from './pdfInstallCommit';

describe('atomic PDF installation and undo-history commit',()=>{
  it('records the edit synchronously without waiting for old-worker disposal',async()=>{
    let release!:()=>void;
    const teardown=new Promise<void>(resolve=>{release=resolve;});
    const state={document:'before',history:['before'],dirty:false};
    state.document='modified';
    finishPdfInstallCommit(()=>{
      state.history.push('modified');
      state.dirty=true;
    },()=>teardown);
    expect(state).toEqual({document:'modified',history:['before','modified'],dirty:true});
    // A competing load may now start and fail. The accepted document remains
    // fully undoable, independent of old-worker cleanup completion.
    await expect(Promise.reject(new Error('corrupt new load'))).rejects.toThrow(/corrupt/);
    expect(state.history).toEqual(['before','modified']);
    release();
    await teardown;
  });
  it('commits undo and redo state even if old-worker teardown rejects',async()=>{
    let history={cursor:1,dirty:true};
    finishPdfInstallCommit(()=>{history={cursor:0,dirty:false};},()=>Promise.reject(new Error('cleanup')));
    expect(history).toEqual({cursor:0,dirty:false});
    await Promise.resolve();
    finishPdfInstallCommit(()=>{history={cursor:1,dirty:true};},()=>Promise.resolve());
    expect(history).toEqual({cursor:1,dirty:true});
  });
  it('does not dispose the current worker before history state is committed',()=>{
    const events:string[]=[];
    finishPdfInstallCommit(()=>events.push('commit'),async()=>{events.push('dispose');});
    expect(events).toEqual(['commit','dispose']);
  });
});
