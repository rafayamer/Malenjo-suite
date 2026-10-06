import { describe,expect,it } from 'vitest';
import type { PdfProviderComponentStatus, PdfProviderOperation } from './backend';
import { applyPdfProviderCapabilities, resolvePdfProviderCapability } from './providerCapabilities';

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

  it('normalizes Stirling slash paths, camelCase ids and spaced summaries before provider gating',()=>{
    const variants=[
      {path:'/api/v1/convert/pdf/word',id:'convertPDFToWord',summary:'Convert PDF to Word'},
      {path:'/api/v1/convert/pdf/presentation',id:'convertPDFToPresentation',summary:'Convert PDF to Presentation'},
      {path:'/api/v1/convert/pdf/html',id:'convertPDFToHTML',summary:'Convert PDF to HTML'},
    ];
    for(const variant of variants){
      const result=resolvePdfProviderCapability(variant,[]);
      expect(result.available).toBe(false);
      expect(result.providerId).toMatch(/libreoffice|pdftohtml/);
    }
  });

  it('enables OCR and scanned-page auto-rotate only when reviewed Tesseract is available',()=>{
    const tesseract:PdfProviderComponentStatus={
      id:'tesseract',
      available:true,
      version:'5.5.3',
      executable:'C:\\MALENJO\\providers\\tesseract\\tesseract.exe',
      source:'bundled',
      message:'ready',
    };
    for(const path of ['/api/v1/misc/ocr-pdf','/api/v1/misc/auto-rotate-pdf']){
      const result=resolvePdfProviderCapability(operation(path),[tesseract]);
      expect(result.available).toBe(true);
      expect(result.providerId).toBe('tesseract');
      expect(result.providerVersion).toBe('5.5.3');
      expect(result.componentPack).toBe('tesseract-windows-x64');
    }
  });

  it('removes OCRmyPDF-only controls from the direct Tesseract operation surface',()=>{
    const tesseract:PdfProviderComponentStatus={
      id:'tesseract',
      available:true,
      version:'5.5.3',
      executable:'C:\\MALENJO\\providers\\tesseract\\tesseract.exe',
      source:'bundled',
      message:'ready',
    };
    const raw:PdfProviderOperation={
      id:'processPdfWithOCR',
      path:'/api/v1/misc/ocr-pdf',
      method:'POST',
      summary:'Process PDF with OCR',
      description:'',
      tags:[],
      category:'scan',
      capability:resolvePdfProviderCapability(operation('/api/v1/misc/ocr-pdf'),[]),
      fields:[
        {name:'fileInput',label:'File',kind:'file',required:true,location:'form'},
        {name:'languages',label:'Languages',kind:'json',required:true,location:'form'},
        {name:'ocrType',label:'OCR Type',kind:'string',required:true,location:'form'},
        {name:'deskew',label:'Deskew',kind:'boolean',required:false,location:'form'},
        {name:'sidecar',label:'Sidecar',kind:'boolean',required:false,location:'form'},
        {name:'removeImagesAfter',label:'Remove images',kind:'boolean',required:false,location:'form'},
      ],
    };
    const resolved=applyPdfProviderCapabilities([raw],[tesseract])[0];
    expect(resolved.fields.map((field)=>field.name)).toEqual(['fileInput','languages','ocrType']);
    expect(resolved.fields.find((field)=>field.name==='languages')).toEqual(expect.objectContaining({
      kind:'string',
      defaultValue:'eng',
    }));
    expect(resolved.capability.fallback).toMatch(/not exposed/i);
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
