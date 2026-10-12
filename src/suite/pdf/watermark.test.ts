import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName,StandardFonts} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {applyPdfTextWatermark} from './watermark';

async function source(pages=2):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=pages;i++){
    const page=pdf.addPage([550,720]);
    page.drawText('Untouched content page '+i,{x:60,y:620,font,size:17});
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

async function pdfjsText(bytes:Uint8Array):Promise<string[]>{
  const task=getDocument({data:Uint8Array.from(bytes),useSystemFonts:true});
  const doc=await task.promise;
  try{
    const text:string[]=[];
    for(let i=1;i<=doc.numPages;i++){
      const page=await doc.getPage(i);
      const content=await page.getTextContent();
      text.push(content.items.map(item=>'str' in item?item.str:'').join(' '));
    }
    return text;
  }finally{
    await doc.destroy();
  }
}

describe('actual PDF text watermark generation',()=>{
  const settings={text:'REVIEWED COPY',size:24,opacity:0.3,angle:0,
    position:'center' as const};

  it('writes a visible selectable watermark to both pages, independent PDF.js reader',async()=>{
    const input=await source();
    const original=Uint8Array.from(input);
    const output=await applyPdfTextWatermark(input,settings);
    expect(Array.from(input)).toEqual(Array.from(original));
    const reopened=await PDFDocument.load(output);
    expect(reopened.getPageCount()).toBe(2);
    const text=await pdfjsText(output);
    expect(text).toHaveLength(2);
    for(let i=0;i<2;i++){
      expect(text[i]).toContain('REVIEWED COPY');
      expect(text[i]).toContain('Untouched content page '+(i+1));
    }
  });

  it('accepts selected-page scope without adding watermark to other pages',async()=>{
    const output=await applyPdfTextWatermark(await source(3),{
      ...settings,pageNumbers:[2,2],
    });
    const text=await pdfjsText(output);
    expect(text[0]).not.toContain('REVIEWED COPY');
    expect(text[1]).toContain('REVIEWED COPY');
    expect(text[2]).not.toContain('REVIEWED COPY');
  });

  it('refuses missing, oversized, unsupported and unsafe parameters',async()=>{
    const original=await source();
    for(const opt of [
      {...settings,text:''},
      {...settings,text:'مرحبا'},
      {...settings,opacity:0},
      {...settings,opacity:1.1},
      {...settings,angle:95},
      {...settings,size:120},
      {...settings,pageNumbers:[0]},
      {...settings,pageNumbers:[99]},
    ]){
      await expect(applyPdfTextWatermark(original,opt)).rejects.toThrow();
    }
    expect(await pdfjsText(original)).toEqual([
      expect.stringContaining('Untouched content page 1'),
      expect.stringContaining('Untouched content page 2'),
    ]);
  });

  it('refuses certified source PDFs instead of invalidating permissions',async()=>{
    const pdf=await PDFDocument.load(await source(1));
    pdf.catalog.set(PDFName.of('Perms'),pdf.context.obj({DocMDP:{Type:PDFName.of('Sig')}}));
    const certified=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(applyPdfTextWatermark(certified,settings))
      .rejects.toThrow(/Certified/);
  });
});
