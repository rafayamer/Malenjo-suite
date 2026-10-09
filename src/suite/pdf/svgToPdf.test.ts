import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFDict,PDFName} from 'pdf-lib';
import {convertSvgToPdf,SVG_TO_PDF_MAX_INPUT_BYTES} from './svgToPdf';

const svg=(shapes:string,attrs='width="240" height="100" viewBox="0 0 240 100"')=>
  '<svg xmlns="http://www.w3.org/2000/svg" '+attrs+'>'+shapes+'</svg>';
const bytes=(text:string)=>new TextEncoder().encode(text);
async function accepts(source:string){
  return PDFDocument.load(await convertSvgToPdf(bytes(source)),{updateMetadata:false});
}
describe('safe offline SVG shapes to real vector PDF',()=>{
  it('imports paths, rectangles, lines and ellipses as one fully reopenable PDF page',async()=>{
    const result=await accepts(svg(
      '<rect x="0" y="0" width="240" height="100" fill="#abcdef"/>'+
      '<circle cx="40" cy="40" r="12" fill="#00f"/>'+
      '<ellipse cx="90" cy="55" rx="10" ry="25" fill="none" stroke="#12AB34" stroke-width="2"/>'+
      '<line x1="0" y1="0" x2="240" y2="100" stroke="#ff0000"/>'+
      '<path d="M 30 30 L 70 30 L 70 70 Z" fill="#000000"/>',
    ));
    expect(result.getPageCount()).toBe(1);
    expect(result.getPage(0).getWidth()).toBe(180);
    expect(result.getPage(0).getHeight()).toBe(75);
    const xobject=result.getPage(0).node.normalizedEntries().Resources.lookupMaybe(
      PDFName.of('XObject'),PDFDict);
    expect(xobject?.size()??0).toBe(0);
  });
  it('accepts nonzero viewBox origins without pixel rasterization',async()=>{
    const pdf=await accepts(svg('<rect x="100" y="-50" width="50" height="25" fill="#f00"/>',
      'width="200" height="100" viewBox="100 -50 200 100"'));
    expect(pdf.getPage(0).getWidth()).toBe(150);
    expect(pdf.getPage(0).getHeight()).toBe(75);
  });
  it('rejects executable SVG, external network resources and nested or unsupported XML',async()=>{
    const candidates=[
      svg('<script>alert(1)</script>'),
      '<svg onload="alert(1)" width="20" height="20"><path d="M0 0"/></svg>',
      svg('<image href="http://127.0.0.1/private" width="20" height="20"/>'),
      svg('<foreignObject><p>HTML</p></foreignObject>'),
      svg('<path d="M0 0" style="fill:url(http://evil)"/>'),
      svg('<path d="M0 0" fill="url(#paint)"/>'),
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'+svg('<path d="M0 0"/>'),
      svg('<g><rect x="0" y="0" width="1" height="1"/></g>'),
    ];
    for(const item of candidates){
      await expect(convertSvgToPdf(bytes(item))).rejects.toThrow();
    }
  });
  it('refuses unsupported shapes, malformed colors and unsafe path commands',async()=>{
    const cases=[
      '<path d="M0 0 L10 10" fill="red"/>',
      '<path d="M0 0 X10 10"/>',
      '<rect width="0" height="10"/>',
      '<circle cx="5" cy="5" r="-1"/>',
      '<line x1="0" x2="2" y1="0" y2="3"/>',
      '<path d="M0 0" opacity="5"/>',
      '<rect x="0" y="0" width="10" height="10" onclick="evil()"/>',
    ];
    for(const shape of cases){
      await expect(convertSvgToPdf(bytes(svg(shape)))).rejects.toThrow();
    }
  });
  it('rejects invalid UTF-8, nonfinite dimensions and huge inputs',async()=>{
    await expect(convertSvgToPdf(Uint8Array.from([0xff,0xfe,0x00,0x01])))
      .rejects.toThrow();
    await expect(convertSvgToPdf(bytes(svg('<path d="M0 0"/>',
      'width="NaN" height="100"')))).rejects.toThrow(/finite/);
    await expect(convertSvgToPdf(bytes(svg('<path d="M0 0"/>',
      'width="30000" height="100"')))).rejects.toThrow(/dimensions/);
    expect(SVG_TO_PDF_MAX_INPUT_BYTES).toBe(2*1024*1024);
    await expect(convertSvgToPdf(new Uint8Array(SVG_TO_PDF_MAX_INPUT_BYTES+1)))
      .rejects.toThrow(/2 MB/);
  });
  it('caps complexity at 2,000 source vector primitives',async()=>{
    const shapes='<rect width="1" height="1"/>'.repeat(2001);
    await expect(convertSvgToPdf(bytes(svg(shapes)))).rejects.toThrow(/2,000-shape/);
  });
});
