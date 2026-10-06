import { describe,expect,it } from 'vitest';
import type { PdfProviderComponentStatus, PdfProviderOperation } from './backend';
import { resolvePdfProviderCapability } from './providerCapabilities';

function operation(path:string,id=path.split('/').at(-1)??'tool'):Pick<PdfProviderOperation,'id'|'path'|'summary'>{
  return {id,path,summary:id};
}

const qpdf:PdfProviderComponentStatus={
  id:'qpdf',
  available:true,
  version:'12.4.2',
  executable:'C:\\MALENJO\\providers\\qpdf\\qpdf.exe',
  source:'bundled',
  message:'ready',
};

describe('PDF provider capability resolver',()=>{
  it('uses approved qpdf for repair and records the Java/PDFBox fallback',()=>{
    const result=resolvePdfProviderCapability(operation('/api/v1/misc/repair','repairPdf'),[qpdf]);
    expect(result).toEqual(expect.objectContaining({
      available:true,
      providerId:'qpdf',
      providerVersion:'12.4.2',
      componentPack:'qpdf-windows-x64',
    }));
    expect(result.fallback).toMatch(/PDFBox/i);
  });

  it('keeps repair and compression operational through real core fallbacks when qpdf is absent',()=>{
    const repair=resolvePdfProviderCapability(operation('/api/v1/misc/repair','repairPdf'),[]);
    const compress=resolvePdfProviderCapability(operation('/api/v1/misc/compress-pdf','optimizePdf'),[]);
    expect(repair.available).toBe(true);
    expect(repair.providerId).toBe('stirling-core');
    expect(compress.available).toBe(true);
    expect(compress.providerId).toBe('stirling-core');
  });

  it('does not advertise Ghostscript-only operations without an approved provider',()=>{
    for(const path of [
      '/api/v1/misc/replace-invert-pdf',
      '/api/v1/misc/scanner-effect',
      '/api/v1/convert/pdf-to-vector',
      '/api/v1/convert/vector-to-pdf',
    ]){
      const result=resolvePdfProviderCapability(operation(path),[]);
      expect(result.available).toBe(false);
      expect(result.providerId).toBe('ghostscript');
      expect(result.disabledReason).toMatch(/not bundled/i);
    }
  });

  it('does not turn absent OCR/Office/proprietary providers into operational tools',()=>{
    expect(resolvePdfProviderCapability(operation('/api/v1/misc/ocr-pdf'),[]).available).toBe(false);
    expect(resolvePdfProviderCapability(operation('/api/v1/convert/pdf-to-word'),[]).available).toBe(false);
    expect(resolvePdfProviderCapability(operation('/api/v1/misc/form-detection'),[]).available).toBe(false);
  });

  it('keeps Java alternatives operational for crop and Markdown conversion',()=>{
    expect(resolvePdfProviderCapability(operation('/api/v1/general/crop'),[]).providerId).toBe('stirling-core');
    expect(resolvePdfProviderCapability(operation('/api/v1/convert/markdown-to-pdf'),[]).available).toBe(true);
  });
});
