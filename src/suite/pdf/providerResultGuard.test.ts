import {describe,expect,it} from 'vitest';
import type {PdfProviderResponse} from './backend';
import {classifyPdfProviderResult,PDF_PROVIDER_MAX_OUTPUT_BYTES} from './providerResultGuard';
import {responseIsPdf} from './stirlingCore';

const pdfBytes=[37,80,68,70,45,49,46,55];

function response(
  bytes:number[]=pdfBytes,status=200,contentType:string|null='application/pdf',
):PdfProviderResponse{
  return {status,contentType,bytes};
}

describe('PDF provider output safety before applying document changes',()=>{
  it('classifies only byte-identifiable PDFs as a document mutation',()=>{
    expect(classifyPdfProviderResult(response(),' /api/v1/general/merge-pdfs'.trim(),responseIsPdf))
      .toBe('apply-pdf');
    expect(classifyPdfProviderResult(response(pdfBytes,200,'application/octet-stream'),'/api/v1/general/merge-pdfs',responseIsPdf))
      .toBe('apply-pdf');
    expect(classifyPdfProviderResult(response([123,125],200,'application/json'),'/api/v1/security/get-info-on-pdf',responseIsPdf))
      .toBe('save-file');
  });

  it('exports newly protected PDFs as copies without attempting to overwrite the active viewer',()=>{
    expect(classifyPdfProviderResult(response(),'/api/v1/security/add-password',responseIsPdf))
      .toBe('save-pdf-copy');
    expect(classifyPdfProviderResult(response(),'/api/v1/security/remove-password',responseIsPdf))
      .toBe('apply-pdf');
  });

  it('rejects failed HTTP responses and mislabeled HTML or empty PDF output',()=>{
    expect(()=>classifyPdfProviderResult(response(pdfBytes,500),'/api/v1/general/merge-pdfs',responseIsPdf))
      .toThrow(/unsuccessful response/i);
    expect(()=>classifyPdfProviderResult(response([],200),'/api/v1/general/merge-pdfs',responseIsPdf))
      .toThrow(/missing/i);
    expect(()=>classifyPdfProviderResult(response([60,104,116,109,108,62],200),'/api/v1/general/merge-pdfs',responseIsPdf))
      .toThrow(/invalid output/i);
  });

  it('enforces a finite bounded maximum for each provider result',()=>{
    expect(PDF_PROVIDER_MAX_OUTPUT_BYTES).toBe(512*1024*1024);
    expect(()=>classifyPdfProviderResult(response(pdfBytes,0),'/api/v1/general/merge-pdfs',responseIsPdf))
      .toThrow(/unsuccessful response/i);
  });
});
