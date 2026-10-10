import {describe,expect,it} from 'vitest';
import type {
  PdfProviderOperation,PdfProviderComponentStatus,PdfProviderStatus,
} from './backend';
import {buildLocalPdfApiManual,PDF_API_MANUAL_MAX_OPERATIONS} from './pdfApiManual';

const operation=(
  path:string,available=true,
):PdfProviderOperation=>({
  id:'test-operation',path,method:'POST',
  summary:'Example local conversion',description:'not executed',
  category:'convert',tags:['test'],
  fields:[{
    name:'password',label:'Owner password',kind:'string',
    required:false,location:'form',defaultValue:'DO-NOT-SERIALIZE',
  },{
    name:'fileInput',label:'PDF',kind:'file',
    required:true,location:'form',accept:'.pdf',
  }],
  capability:{
    available,implementation:'Core provider',
    providerId:'stirling-core',legalReference:'approved-local-reference',
  },
});
const components:PdfProviderComponentStatus[]=[{
  id:'tesseract',available:false,source:'unavailable',
  executable:'C:\\private\\secret\\bin\\tesseract.exe',
  version:'5.5',message:'internal environment details',
}];
const status:PdfProviderStatus={
  installed:true,running:true,endpoint:'http://127.0.0.1:28970',
  packagePath:'C:\\user\\private-path',
  runtime:'C:\\user\\private-java',
  message:'secret environment details',
};
describe('local PDF provider API diagnostics',()=>{
  it('documents actual API operations and capabilities without inventing acceptance',()=>{
    const output=buildLocalPdfApiManual([operation('/api/v1/general/crop')],components,status);
    const json=JSON.parse(new TextDecoder().decode(output));
    expect(json.schemaVersion).toBe(1);
    expect(json.operationCount).toBe(1);
    expect(json.reportedEnabled).toBe(1);
    expect(json.operations[0]).toMatchObject({
      method:'POST',path:'/api/v1/general/crop',reportedAvailable:true,
    });
    expect(json.warning).toContain('not evidence of verified execution');
  });
  it('does not leak passwords, uploaded files, local paths or sensitive defaults',()=>{
    const result=new TextDecoder().decode(
      buildLocalPdfApiManual([operation('/api/v1/security/add-password')],components,status),
    );
    expect(result).toContain('"name": "password"');
    expect(result).not.toContain('DO-NOT-SERIALIZE');
    expect(result).not.toContain('private-path');
    expect(result).not.toContain('private-java');
    expect(result).not.toContain('tesseract.exe');
    expect(result).not.toContain('internal environment details');
    expect(result).not.toContain('secret environment details');
  });
  it('rejects missing route slash and duplicate method/path entries',()=>{
    expect(()=>buildLocalPdfApiManual([operation('api/v1/crop')],[],status))
      .toThrow(/invalid or oversized/);
    expect(()=>buildLocalPdfApiManual([
      operation('/api/v1/crop'),operation('/api/v1/crop'),
    ],[],status)).toThrow(/duplicate/);
  });
  it('fails safely for oversized runtime API catalogs',()=>{
    const many=Array.from({length:PDF_API_MANUAL_MAX_OPERATIONS+1},(_,i)=>
      operation('/api/v1/check/'+i));
    expect(()=>buildLocalPdfApiManual(many,[],status))
      .toThrow(/safe diagnostics limit/);
  });
});
