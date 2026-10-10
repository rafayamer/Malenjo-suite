import {describe,expect,it} from 'vitest';
import type {PdfProviderStatus,PdfToolProvider} from './backend';
import {ensurePdfProviderRunning} from './providerLifecycle';

const stopped:PdfProviderStatus={
  installed:true,running:false,endpoint:'http://127.0.0.1:28970',message:'Installed but stopped.',
};
const ready:PdfProviderStatus={...stopped,running:true,message:'Ready.'};

describe('background PDF engine lifecycle',()=>{
  it('does not restart a running engine',async()=>{
    let starts=0;
    const provider:Pick<PdfToolProvider,'status'|'start'>={
      status:async()=>ready,
      start:async()=>{starts++;return ready;},
    };
    await expect(ensurePdfProviderRunning(provider)).resolves.toMatchObject({running:true});
    expect(starts).toBe(0);
  });

  it('deduplicates concurrent starts triggered by multiple PDF tabs',async()=>{
    let starts=0;
    let release!:(value:PdfProviderStatus)=>void;
    const startPromise=new Promise<PdfProviderStatus>(resolve=>{release=resolve;});
    const provider:Pick<PdfToolProvider,'status'|'start'>={
      status:async()=>stopped,
      start:async()=>{starts++;return startPromise;},
    };
    const all=[
      ensurePdfProviderRunning(provider),
      ensurePdfProviderRunning(provider),
      ensurePdfProviderRunning(provider),
    ];
    expect(all[0]).toBe(all[1]);
    await Promise.resolve();
    expect(starts).toBe(1);
    release(ready);
    expect((await Promise.all(all)).every(x=>x.running)).toBe(true);
  });

  it('reports missing provider packs instead of starting or inventing success',async()=>{
    let starts=0;
    const provider:Pick<PdfToolProvider,'status'|'start'>={
      status:async()=>({...stopped,installed:false,message:'Stirling pack missing.'}),
      start:async()=>{starts++;return ready;},
    };
    await expect(ensurePdfProviderRunning(provider)).rejects.toThrow('Stirling pack missing.');
    expect(starts).toBe(0);
  });

  it('does not cache failures and can retry once the runtime is repaired',async()=>{
    let shouldFail=true;
    let starts=0;
    const provider:Pick<PdfToolProvider,'status'|'start'>={
      status:async()=>stopped,
      start:async()=>{
        starts++;
        if(shouldFail)throw new Error('Java not found.');
        return ready;
      },
    };
    await expect(ensurePdfProviderRunning(provider)).rejects.toThrow('Java not found.');
    shouldFail=false;
    await expect(ensurePdfProviderRunning(provider)).resolves.toMatchObject({running:true});
    expect(starts).toBe(2);
  });

  it('rejects a start call that returns unhealthy status',async()=>{
    const provider:Pick<PdfToolProvider,'status'|'start'>={
      status:async()=>stopped,start:async()=>stopped,
    };
    await expect(ensurePdfProviderRunning(provider)).rejects.toThrow('Installed but stopped.');
  });
});
