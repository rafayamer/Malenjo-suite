import { describe, expect, it, vi } from 'vitest';
import type { PdfOptionalContentConfig } from './optionalLayers';
import {
  listPdfOptionalLayers, MAX_PDF_OPTIONAL_LAYERS,
  restorePdfOptionalLayerVisibility, setPdfOptionalLayerVisibility,
} from './optionalLayers';

function fake(groups: Record<string, {name:string;visible:boolean}>):PdfOptionalContentConfig {
  const values=new Map(Object.entries(groups).map(([id,value])=>[id,{name:value.name}]));
  const visibility=new Map(Object.entries(groups).map(([id,value])=>[id,value.visible]));
  return {
    getOrder:()=>[...values.keys()],
    getGroup:(id:string)=>values.get(id)??null,
    isVisible:({id}:{id:string})=>visibility.get(id),
    setVisibility:vi.fn((id:string,visible:boolean)=>{visibility.set(id,visible);}),
  } as unknown as PdfOptionalContentConfig;
}

describe('PDF optional-content view controls',()=>{
  it('discovers PDF.js 6.4 optional layer order and groups',()=>{
    const config=fake({first:{name:'Plan',visible:true},second:{name:'Notes',visible:false}});
    expect(listPdfOptionalLayers(config)).toEqual([
      {id:'first',name:'Plan',visible:true},
      {id:'second',name:'Notes',visible:false},
    ]);
  });

  it('flattens nested named order groups without inventing layers',()=>{
    const config=fake({a:{name:'Layer A',visible:true},b:{name:'Layer B',visible:false}});
    config.getOrder=()=>[{name:'Folder',order:['b','a']}];
    expect(listPdfOptionalLayers(config).map(item=>item.id)).toEqual(['b','a']);
  });

  it('changes view configuration and restores initial layer states',()=>{
    const config=fake({first:{name:'Plan',visible:true},second:{name:'Notes',visible:false}});
    const before=listPdfOptionalLayers(config);
    expect(setPdfOptionalLayerVisibility(config,'first',false)[0].visible).toBe(false);
    expect(setPdfOptionalLayerVisibility(config,'second',true)[1].visible).toBe(true);
    expect(restorePdfOptionalLayerVisibility(config,before)).toEqual(before);
    expect(config.setVisibility).toHaveBeenCalledWith('first',false,true);
  });

  it('rejects unknown stale layer references without mutating config',()=>{
    const config=fake({id:{name:'Existing',visible:true}});
    expect(()=>setPdfOptionalLayerVisibility(config,'other',false)).toThrow(/no longer exists/i);
    expect(config.setVisibility).not.toHaveBeenCalled();
  });

  it('never silently omits excess layers',()=>{
    const input=Object.fromEntries(Array.from({length:MAX_PDF_OPTIONAL_LAYERS+1},(_,i)=>[
      'layer-'+i,{name:'Layer '+i,visible:true},
    ]));
    const config=fake(input);
    expect(()=>listPdfOptionalLayers(config)).toThrow(/No incomplete list/i);
  });

  it('supports PDFs with no optional content',()=>{
    const config=fake({});
    expect(listPdfOptionalLayers(config)).toEqual([]);
  });
});
