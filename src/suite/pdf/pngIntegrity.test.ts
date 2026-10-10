import {describe,expect,it} from 'vitest';
import {zlibSync,zipSync} from 'fflate';
import {validatePngRaster} from './pngIntegrity';
import {classifyPdfBatchOutput,PDF_TWENTY_WORKFLOWS} from './pdfTwentyWorkflows';
import {responseIsPdf} from './stirlingCore';

function be32(value:number):number[]{
  return [(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255];
}
function chunk(name:string,data:number[]):number[]{
  const body=[...Array.from(name).map(char=>char.charCodeAt(0)),...data];
  let crc=0xffffffff;
  for(const value of body){
    crc^=value;
    for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return [...be32(data.length),...body,...be32((crc^0xffffffff)>>>0)];
}
interface TestImage{
  width:number;height:number;depth:number;color:number;interlace:number;
  raster:number[];palette?:number[];
}
function png({width,height,depth,color,interlace,raster,palette=[]}:TestImage):Uint8Array{
  return Uint8Array.from([
    137,80,78,71,13,10,26,10,
    ...chunk('IHDR',[...be32(width),...be32(height),depth,color,0,0,interlace]),
    ...(palette.length?chunk('PLTE',palette):[]),
    ...chunk('IDAT',Array.from(zlibSync(Uint8Array.from(raster)))),
    ...chunk('IEND',[]),
  ]);
}
function adam7(width:number,height:number,depth:number,channels:number,filter=0):number[]{
  const passes:[[number,number,number,number],...Array<[number,number,number,number]>]=[
    [0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],
    [0,2,2,4],[1,0,2,2],[0,1,1,2],
  ];
  const data:number[]=[];
  for(const [x,y,dx,dy] of passes){
    const pw=width>x?Math.ceil((width-x)/dx):0;
    const ph=height>y?Math.ceil((height-y)/dy):0;
    if(!pw||!ph)continue;
    const rowBytes=Math.ceil(pw*depth*channels/8);
    for(let row=0;row<ph;row++)data.push(filter,...Array(rowBytes).fill(0));
  }
  return data;
}
const imageWorkflow=PDF_TWENTY_WORKFLOWS.find(item=>item.id==='extract-images')!;

describe('PNG integrity and release-export acceptance',()=>{
  it('accepts valid Adam7 interlaced indexed PNGs through direct and ZIP provider exports',async()=>{
    const image=png({
      width:8,height:8,depth:1,color:3,interlace:1,
      palette:[0,0,0],
      raster:adam7(8,8,1,1),
    });
    expect(validatePngRaster(image)).toBe(true);
    const direct={status:200,bytes:Array.from(image),contentType:'image/png'};
    expect(await classifyPdfBatchOutput(imageWorkflow,direct,responseIsPdf)).toBe('save-file');
    const archive={status:200,bytes:Array.from(zipSync({'adam7.png':image})),contentType:'application/zip'};
    expect(await classifyPdfBatchOutput(imageWorkflow,archive,responseIsPdf)).toBe('save-file');
  });
  it('accepts Adam7 grayscale, RGB and RGBA at standard depths and with PNG filters',()=>{
    for(const [color,depth,channels] of [[0,1,1],[0,16,1],[2,8,3],[6,8,4]]){
      const image=png({
        width:8,height:8,depth,color,interlace:1,
        raster:adam7(8,8,depth,channels,2),
      });
      expect(validatePngRaster(image)).toBe(true);
    }
  });
  it('rejects an out-of-range palette sample even when CRC, IDAT, and zlib are valid',async()=>{
    const image=png({width:1,height:1,depth:1,color:3,interlace:0,
      palette:[1,2,3],raster:[0,0x80]});
    expect(validatePngRaster(image)).toBe(false);
    await expect(classifyPdfBatchOutput(imageWorkflow,{
      status:200,bytes:Array.from(image),contentType:'image/png',
    },responseIsPdf)).rejects.toThrow(/image/i);
    await expect(classifyPdfBatchOutput(imageWorkflow,{
      status:200,bytes:Array.from(zipSync({'out-of-range.png':image})),contentType:'application/zip',
    },responseIsPdf)).rejects.toThrow(/image/i);
  });
  it('checks reconstructed palette samples after Up filtering (not just raw bytes)',()=>{
    const bad=png({width:1,height:2,depth:1,color:3,interlace:0,
      palette:[1,2,3],raster:[0,0,2,0x80]});
    const valid=png({width:1,height:2,depth:1,color:3,interlace:0,
      palette:[1,2,3],raster:[0,0,2,0]});
    expect(validatePngRaster(valid)).toBe(true);
    expect(validatePngRaster(bad)).toBe(false);
  });
  it('checks palette bounds for each Adam7 pass including the first pixel',()=>{
    const raster=adam7(8,8,1,1);
    // The first interlaced row consists of a filter byte and one palette sample.
    raster[1]=0x80;
    const bad=png({width:8,height:8,depth:1,color:3,interlace:1,
      palette:[0,0,0],raster});
    expect(validatePngRaster(bad)).toBe(false);
  });
  it('refuses illegal PNG interlace methods, damaged CRCs and incomplete pass rasters',()=>{
    const base:TestImage={width:8,height:8,depth:1,color:3,interlace:1,
      palette:[0,0,0],raster:adam7(8,8,1,1)};
    expect(validatePngRaster(png({...base,interlace:2}))).toBe(false);
    expect(validatePngRaster(png({...base,raster:base.raster.slice(0,-1)}))).toBe(false);
    const corrupt=png(base);
    corrupt[25]^=1;
    expect(validatePngRaster(corrupt)).toBe(false);
    expect(validatePngRaster(png({...base,width:32769}))).toBe(false);
  });
});
