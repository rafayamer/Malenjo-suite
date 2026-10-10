import {describe,expect,it} from 'vitest';
import type {PdfProviderOperationField} from './backend';
import {PDF_PROVIDER_RENDERER_UPLOAD_LIMIT,validatePdfOperationValue,validatePdfUploadPlan} from './providerRequestGuard';

function field(kind:PdfProviderOperationField['kind'],overrides:Partial<PdfProviderOperationField>={}):PdfProviderOperationField{
  return {name:'value',label:'Value',kind,required:true,location:'form',...overrides};
}
describe('renderer-side safe provider request bounds',()=>{
  it('permits bounded active + additional files without allocating their bytes',()=>{
    expect(PDF_PROVIDER_RENDERER_UPLOAD_LIMIT).toBe(32*1024*1024);
    expect(()=>validatePdfUploadPlan([{name:'a.pdf',size:1234}],PDF_PROVIDER_RENDERER_UPLOAD_LIMIT-1234)).not.toThrow();
  });
  it('rejects oversize, malicious metadata and invalid input counts before JS number[] conversion',()=>{
    expect(()=>validatePdfUploadPlan([{name:'a.pdf',size:1}],PDF_PROVIDER_RENDERER_UPLOAD_LIMIT)).toThrow(/32 MB/);
    expect(()=>validatePdfUploadPlan([],PDF_PROVIDER_RENDERER_UPLOAD_LIMIT+1)).toThrow(/32 MB/);
    expect(()=>validatePdfUploadPlan([],Infinity)).toThrow(/invalid size/);
    expect(()=>validatePdfUploadPlan([{name:'a.pdf',size:-1}])).toThrow(/nonnegative/);
    expect(()=>validatePdfUploadPlan([{name:'a.pdf',size:NaN}])).toThrow(/nonnegative/);
    expect(()=>validatePdfUploadPlan([{name:'x'.repeat(513),size:1}])).toThrow(/name/);
    for(const name of ['../secret.pdf','folder/file.pdf','folder\\file.pdf','C:secret.pdf','..','report\u0000.pdf','a\n.pdf']){
      expect(()=>validatePdfUploadPlan([{name,size:1}])).toThrow(/name/);
    }
    expect(()=>validatePdfUploadPlan([{name:'MALENJO résumé 你好.pdf',size:1}])).not.toThrow();
    expect(()=>validatePdfUploadPlan(Array.from({length:65},(_,i)=>({name:String(i),size:1})))).toThrow(/64/);
  });
  it('validates numeric and enumeration schema constraints',()=>{
    expect(()=>validatePdfOperationValue(field('number'),'3.5')).not.toThrow();
    expect(()=>validatePdfOperationValue(field('number'),'Infinity')).toThrow(/number/);
    expect(()=>validatePdfOperationValue(field('integer'),'2.5')).toThrow(/integer/);
    expect(()=>validatePdfOperationValue(field('integer'),'9007199254740992')).toThrow(/integer/);
    expect(()=>validatePdfOperationValue(field('string',{enumValues:['A4','Letter']}),'not-supported')).toThrow(/option/);
  });
  it('rejects required empties, invalid booleans, malformed JSON and oversized text',()=>{
    expect(()=>validatePdfOperationValue(field('string'),'  ')).toThrow(/required/);
    expect(()=>validatePdfOperationValue(field('boolean'),'yes')).toThrow(/true or false/);
    expect(()=>validatePdfOperationValue(field('json'),'{x:}')).toThrow(/valid JSON/);
    expect(()=>validatePdfOperationValue(field('json'),'{"a":1}')).not.toThrow();
    expect(()=>validatePdfOperationValue(field('string'),'x'.repeat(1_000_001))).toThrow(/too long/);
    expect(()=>validatePdfOperationValue(field('file'),'')).not.toThrow();
  });
});
