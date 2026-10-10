import {describe,expect,it,vi} from 'vitest';
import {PDFDocument,PDFName,StandardFonts} from 'pdf-lib';
import {
  pageMatchesPdfRedaction,parsePdfAutoRedactPatterns,
  redactPdfPagesByText,PDF_AUTO_REDACT_MAX_PAGES,
} from './pdfAutoRedact';

async function sourceDocument(){
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([100,100]).drawText('TOP SECRET',{x:10,y:50,font,size:12});
  pdf.addPage([100,100]).drawText('PUBLIC',{x:10,y:50,font,size:12});
  pdf.setAuthor('Original confidential metadata');
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
function mockPdfReader(texts:string[]){
  return {
    numPages:texts.length,
    getPage:vi.fn(async(number:number)=>({
      getTextContent:async()=>({items:[{str:texts[number-1]}]}),
      getViewport:()=>({width:100,height:100}),
      render:()=>{
        if(number===1)throw new Error('Redacted source page must NEVER be rendered or embedded.');
        return {promise:Promise.resolve(),cancel:vi.fn()};
      },
    })),
  } as never;
}
const goodPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

describe('conservative automatic PDF whole-page redaction',()=>{
  it('validates literal text patterns, prohibits ambiguous duplicates and resource abuse',()=>{
    expect(parsePdfAutoRedactPatterns(' passport \nAccount NUMBER ')).toEqual([
      'passport','Account NUMBER',
    ]);
    expect(pageMatchesPdfRedaction(['account ','num','ber'],['Account number','other']))
      .toEqual(['Account number']);
    expect(pageMatchesPdfRedaction(['secret',' ','phrase'],['SECRET phrase']))
      .toEqual(['SECRET phrase']);
    for(const patterns of [
      '', '\n \n', 'account\nACCOUNT', 'x'.repeat(121),
      'bad\u0000name',Array.from({length:21},(_,i)=>String(i)).join('\n'),
      'a'.repeat(4097),
    ])expect(()=>parsePdfAutoRedactPatterns(patterns)).toThrow();
  });

  it('irreversibly blanks matching pages and rasterizes unredacted pages to a fresh PDF',async()=>{
    const source=await sourceDocument();
    const original=Uint8Array.from(source);
    const png=Uint8Array.from(atob(goodPng),c=>c.charCodeAt(0));
    const canvas={
      width:0,height:0,
      getContext:()=>({}),
      toBlob:(callback:(blob:Blob)=>void)=>{
        const copy=new Uint8Array(new ArrayBuffer(png.length));
        copy.set(png);
        callback(new Blob([copy],{type:'image/png'}));
      },
    };
    vi.stubGlobal('document',{createElement:()=>canvas});
    try{
      const progress=vi.fn();
      const reader=mockPdfReader(['TOP SECRET','PUBLIC NOTICE']);
      const output=await redactPdfPagesByText(source,reader,['top secret'],{
        onProgress:progress,
      });
      expect(source).toEqual(original);
      expect(output.redactedPages).toEqual([1]);
      expect(output.matchedPatterns).toEqual(['top secret']);
      expect(output.pageCount).toBe(2);
      expect(progress).toHaveBeenCalledTimes(2);
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
      const reopened=await PDFDocument.load(output.bytes,{updateMetadata:false});
      expect(reopened.getPageCount()).toBe(2);
      expect(reopened.getPages().map(p=>p.getSize())).toEqual([
        {width:100,height:100},{width:100,height:100},
      ]);
      expect(reopened.getAuthor()).not.toBe('Original confidential metadata');
      // New PDF has only fresh black vector content and freshly rendered
      // PNGs, not the source PDF's original font or text streams.
      const encoded=new TextDecoder('latin1').decode(output.bytes);
      expect(encoded).not.toContain('TOP SECRET');
      expect(encoded).not.toContain('Original confidential metadata');
      expect(reader.getPage).toHaveBeenCalled();
    }finally{
      vi.unstubAllGlobals();
    }
  });

  it('can blank every page without invoking any PDF canvas renderer',async()=>{
    const source=await sourceDocument();
    const reader=mockPdfReader(['TOP SECRET','TOP SECRET again']);
    const result=await redactPdfPagesByText(source,reader,['top secret']);
    expect(result.redactedPages).toEqual([1,2]);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2);
  });

  it('refuses missing phrases, pages without text layers, and empty matches',async()=>{
    const source=await sourceDocument();
    await expect(redactPdfPagesByText(source,mockPdfReader(['secret here','other']),['missing']))
      .rejects.toThrow(/No literal redaction phrases/);
    await expect(redactPdfPagesByText(source,mockPdfReader(['secret here','other']),['secret','missing']))
      .rejects.toThrow(/Not all redaction phrases/);
    await expect(redactPdfPagesByText(source,mockPdfReader(['secret','']),['secret']))
      .rejects.toThrow(/Run OCR first/);
  });

  it('refuses signed or certified input instead of rewriting signatures',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([100,100]);
    pdf.catalog.set(PDFName.of('Perms'),pdf.context.obj({DocMDP:{}}));
    const source=Uint8Array.from(await pdf.save());
    await expect(redactPdfPagesByText(source,mockPdfReader(['secret']),['secret']))
      .rejects.toThrow(/Certified or rights-managed/);
  });

  it('bounds input sizes, page counts, and obeys cancellation',async()=>{
    const source=await sourceDocument();
    expect(PDF_AUTO_REDACT_MAX_PAGES).toBe(20);
    await expect(redactPdfPagesByText(new Uint8Array(0),mockPdfReader(['secret']),['secret']))
      .rejects.toThrow(/32 MB/);
    await expect(redactPdfPagesByText(new Uint8Array(32*1024*1024+1),mockPdfReader(['secret']),['secret']))
      .rejects.toThrow(/32 MB/);
    await expect(redactPdfPagesByText(source,{numPages:21,getPage:async()=>{throw Error('No')}} as never,['secret']))
      .rejects.toThrow(/1 to 20/);
    const controller=new AbortController();controller.abort();
    await expect(redactPdfPagesByText(source,mockPdfReader(['secret','other']),['secret'],{
      signal:controller.signal,
    })).rejects.toMatchObject({name:'AbortError'});
  });
});
