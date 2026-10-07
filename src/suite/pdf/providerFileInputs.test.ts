import { describe,expect,it } from 'vitest';
import type { PdfProviderOperationField } from './backend';
import { fieldAcceptsActivePdf } from './providerFileInputs';

function file(accept?:string):PdfProviderOperationField{
  return {name:'fileInput',label:'File',kind:'file',required:true,location:'form',accept};
}

describe('provider file input compatibility',()=>{
  it('uses the active PDF only for fields that accept PDF input',()=>{
    expect(fieldAcceptsActivePdf(file())).toBe(true);
    expect(fieldAcceptsActivePdf(file('.pdf'))).toBe(true);
    expect(fieldAcceptsActivePdf(file('application/pdf'))).toBe(true);
    expect(fieldAcceptsActivePdf(file('.docx,.pptx,.xlsx,.txt'))).toBe(false);
  });
});
