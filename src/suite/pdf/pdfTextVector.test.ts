import {describe,expect,it} from 'vitest';
import {OPS} from 'pdfjs-dist';
import {unzipSync} from 'fflate';
import {buildPdfTextOnlySvg,exportPdfTextOnlySvgZip} from './pdfTextVector';
const reader=(fnArray:number[],str='Vector & <safe>')=>({
 numPages:1,
 getPage:async()=>({
  getOperatorList:async()=>({fnArray}),
  getTextContent:async()=>({items:[{str,transform:[12,0,0,12,35,60]}]}),
  getViewport:()=>({width:300,height:400}),
 }),
}) as never;
describe('strict SVG selectable-text export',()=>{
 it('produces true UTF-8 SVG text nodes and ZIP file, never raster screenshots',async()=>{
  const result=await exportPdfTextOnlySvgZip(reader([]));
  expect(result.pageCount).toBe(1);
  expect(result.textItems).toBe(1);
  const files=unzipSync(result.archive);
  expect(Object.keys(files)).toEqual(['page-0001.svg']);
  const svg=new TextDecoder().decode(files['page-0001.svg']);
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('font-size="12"');
  expect(svg).toContain('y="340"');
  expect(svg).toContain('Vector &amp; &lt;safe&gt;');
  expect(svg).not.toContain('<image');
 });
 it('refuses image or painted path content rather than discarding it',async()=>{
  for(const name of ['paintImageXObject','constructPath','stroke']){
    const op=(OPS as Record<string,number>)[name];
    expect(Number.isInteger(op)).toBe(true);
    await expect(exportPdfTextOnlySvgZip(reader([op]))).rejects.toThrow(/graphical paths or images/);
  }
 });
 it('rejects rotated text, unsafe coordinates, and blank source',()=>{
  expect(()=>buildPdfTextOnlySvg(100,100,[{str:'x',transform:[0,12,-12,0,5,5]}]))
    .toThrow(/Rotated/);
  expect(()=>buildPdfTextOnlySvg(100,100,[{str:'x',transform:[12,0,0,12,Infinity,5]}]))
    .toThrow(/Malformed/);
  expect(()=>buildPdfTextOnlySvg(100,100,[])).toThrow(/no safely exportable/);
 });
 it('rejects excess pages and honors cancellation',async()=>{
  await expect(exportPdfTextOnlySvgZip({numPages:11,getPage:async()=>{throw Error('unexpected');}} as never))
    .rejects.toThrow(/1 to 10/);
  const signal=new AbortController();signal.abort();
  await expect(exportPdfTextOnlySvgZip(reader([]),{signal:signal.signal}))
    .rejects.toMatchObject({name:'AbortError'});
 });
});
