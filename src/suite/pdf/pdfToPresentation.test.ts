import {describe,expect,it,vi} from 'vitest';
import {zlibSync,zipSync,unzipSync} from 'fflate';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {
  serializePdfRasterPptx,inspectPdfRasterPptx,exportPdfRasterPptx,
  PDF_SLIDES_MAX_PAGES,
} from './pdfToPresentation';

function be32(n:number):number[]{
  return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
}
function chunk(name:string,data:number[]):number[]{
  const bytes=[...Array.from(name).map(x=>x.charCodeAt(0)),...data];
  let crc=0xffffffff;
  for(const byte of bytes){
    crc^=byte;
    for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return [...be32(data.length),...bytes,...be32((crc^0xffffffff)>>>0)];
}
function png(width=2,height=1):Uint8Array{
  const rows:number[]=[];
  for(let y=0;y<height;y++){
    rows.push(0);
    for(let x=0;x<width;x++)rows.push(40,100,200,255);
  }
  return Uint8Array.from([
    137,80,78,71,13,10,26,10,
    ...chunk('IHDR',[...be32(width),...be32(height),8,6,0,0,0]),
    ...chunk('IDAT',Array.from(zlibSync(Uint8Array.from(rows)))),
    ...chunk('IEND',[]),
  ]);
}
const decode=(bytes:Uint8Array)=>new TextDecoder('utf-8').decode(bytes);
describe('PDF to rasterized PowerPoint presentation',()=>{
  it('emits linked OpenXML slides, slide layouts, media, relationship graph and master',()=>{
    const first=png(4,2),second=png(1,4);
    const result=serializePdfRasterPptx([
      {pageNumber:1,bytes:first},{pageNumber:2,bytes:second},
    ]);
    const pkg=unzipSync(result);
    expect(Object.keys(pkg)).toHaveLength(15);
    expect(decode(pkg['[Content_Types].xml'])).toContain('presentationml.slide+xml');
    expect(decode(pkg['ppt/presentation.xml'])).toContain('<p:sldId id="257" r:id="rId3"/>');
    expect(decode(pkg['ppt/_rels/presentation.xml.rels'])).toContain('Target="slides/slide2.xml"');
    expect(decode(pkg['ppt/slideMasters/_rels/slideMaster1.xml.rels'])).toContain('Target="../theme/theme1.xml"');
    expect(decode(pkg['ppt/slideLayouts/_rels/slideLayout1.xml.rels'])).toContain('Target="../slideMasters/slideMaster1.xml"');
    expect(decode(pkg['ppt/slides/_rels/slide1.xml.rels'])).toContain('Target="../media/image1.png"');
    expect(pkg['ppt/media/image1.png']).toEqual(first);
    expect(pkg['ppt/media/image2.png']).toEqual(second);
    expect(inspectPdfRasterPptx(result)).toEqual({slideCount:2,imagesValid:true});
  });
  it('centers portrait and landscape content without stretching original aspect ratios',()=>{
    const pages=[
      {pageNumber:1,bytes:png(4,2)},
      {pageNumber:2,bytes:png(1,4)},
    ];
    const files=unzipSync(serializePdfRasterPptx(pages));
    const horizontal=decode(files['ppt/slides/slide1.xml']);
    const vertical=decode(files['ppt/slides/slide2.xml']);
    expect(horizontal).toContain('<a:off x="0" y="1143000"/>');
    expect(horizontal).toContain('<a:ext cx="9144000" cy="4572000"/>');
    expect(vertical).toContain('<a:ext cx="1714500" cy="6858000"/>');
    expect(vertical).toContain('<a:off x="3714750" y="0"/>');
  });
  it('rejects out-of-order pages and corrupted PNG with a valid ZIP header',()=>{
    expect(()=>serializePdfRasterPptx([{pageNumber:2,bytes:png()}]))
      .toThrow(/ordered PNGs/);
    const damaged=png();damaged[damaged.length-13]^=0x11;
    expect(()=>serializePdfRasterPptx([{pageNumber:1,bytes:damaged}]))
      .toThrow(/damaged PNG/);
  });
  it('rejects unexpected ZIP members and missing relationships in output validator',()=>{
    const files=unzipSync(serializePdfRasterPptx([{pageNumber:1,bytes:png()}]));
    const missing={...files};
    delete missing['ppt/slides/_rels/slide1.xml.rels'];
    expect(()=>inspectPdfRasterPptx(zipSync(missing))).toThrow(/missing or unexpected parts/);
    const extra={...files,'arbitrary.txt':new TextEncoder().encode('bad')};
    expect(()=>inspectPdfRasterPptx(zipSync(extra))).toThrow(/missing or unexpected parts/);
  });
  it('enforces page and cancellation budgets without producing partial presentation',()=>{
    expect(()=>serializePdfRasterPptx(Array.from({length:PDF_SLIDES_MAX_PAGES+1},(_,i)=>({
      pageNumber:i+1,bytes:png(),
    })))).toThrow(/1 to 50/);
    const controller=new AbortController();controller.abort();
    expect(()=>serializePdfRasterPptx([{pageNumber:1,bytes:png()}],controller.signal))
      .toThrow(/cancelled/);
  });
  it('refuses textless input only when raster rendering itself fails',async()=>{
    const empty={numPages:0,getPage:vi.fn()} as unknown as Pick<PDFDocumentProxy,'numPages'|'getPage'>;
    await expect(exportPdfRasterPptx(empty)).rejects.toThrow(/50 pages/);
  });
});
