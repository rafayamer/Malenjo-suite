import {unzlibSync} from 'fflate';

const PNG_SIGNATURE=[137,80,78,71,13,10,26,10];
const PNG_RASTER_LIMIT=128*1024*1024;
const PNG_MAX_SIDE=32768;
type Pass={width:number;height:number};
const ADAM7:readonly [number,number,number,number][]=[
  [0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],
  [0,2,2,4],[1,0,2,2],[0,1,1,2],
];

function be32(buf:Uint8Array,pos:number):number{
  return ((buf[pos]*0x1000000)+(buf[pos+1]<<16)+(buf[pos+2]<<8)+buf[pos+3])>>>0;
}
function crc32(buf:Uint8Array,start:number,end:number):number{
  let crc=0xffffffff;
  for(let i=start;i<end;i++){
    crc^=buf[i];
    for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function passLength(size:number,start:number,step:number):number{
  return size>start?Math.ceil((size-start)/step):0;
}
function paeth(a:number,b:number,c:number):number{
  const predictor=a+b-c;
  const da=Math.abs(predictor-a),db=Math.abs(predictor-b),dc=Math.abs(predictor-c);
  return da<=db&&da<=dc?a:db<=dc?b:c;
}
/**
 * Validate a complete PNG with bounded inflate, chunk CRCs, legal color depths,
 * Adam7 pass layout, reconstructed PNG scanline filters, and indexed palette
 * lookups. This is an export integrity guard, not an image rendering codec.
 */
export function validatePngRaster(bytes:Uint8Array):boolean{
  if(bytes.length<57||!PNG_SIGNATURE.every((value,i)=>bytes[i]===value))return false;
  const validDepths:Record<number,readonly number[]>={
    0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16],
  };
  let width=0,height=0,depth=0,color=0,interlace=0,channels=0,paletteEntries=0;
  let header=false,image=false,endedImage=false,end=false,seenPalette=false;
  let pos=8,compressedLength=0;
  const blocks:Uint8Array[]=[];
  while(pos+12<=bytes.length&&!end){
    const size=be32(bytes,pos);
    const chunkEnd=pos+12+size;
    if(size>PNG_RASTER_LIMIT||chunkEnd>bytes.length)return false;
    const type=String.fromCharCode(...bytes.subarray(pos+4,pos+8));
    if(!/^[A-Za-z]{4}$/.test(type))return false;
    if(crc32(bytes,pos+4,pos+8+size)!==be32(bytes,pos+8+size))return false;
    const data=pos+8;
    if(type==='IHDR'){
      if(header||pos!==8||size!==13)return false;
      width=be32(bytes,data);height=be32(bytes,data+4);
      depth=bytes[data+8];color=bytes[data+9];interlace=bytes[data+12];
      if(!width||!height||width>PNG_MAX_SIDE||height>PNG_MAX_SIDE||
         !validDepths[color]?.includes(depth)||
         bytes[data+10]!==0||bytes[data+11]!==0||![0,1].includes(interlace))return false;
      channels=color===0||color===3?1:color===2?3:color===4?2:4;
      header=true;
    }else if(type==='PLTE'){
      if(!header||image||seenPalette||color===0||color===4||
         !size||size>768||size%3!==0)return false;
      paletteEntries=size/3;
      if(color===3&&paletteEntries>2**depth)return false;
      seenPalette=true;
    }else if(type==='IDAT'){
      if(!header||endedImage||(color===3&&!seenPalette))return false;
      compressedLength+=size;
      if(compressedLength>PNG_RASTER_LIMIT)return false;
      blocks.push(bytes.subarray(data,data+size));image=true;
    }else if(type==='IEND'){
      if(!header||!image||size!==0)return false;
      end=true;
    }else{
      if(!header||type[0]===type[0].toUpperCase())return false;
      // Ancillary chunks are permitted between IHDR/PLTE/IDAT/IEND, except
      // they must not interrupt consecutive IDAT chunks.
      if(type==='tRNS'&&color===3&&(!seenPalette||image||size>paletteEntries))return false;
    }
    if(image&&type!=='IDAT'&&type!=='IEND')endedImage=true;
    pos=chunkEnd;
  }
  if(!header||!image||!end||pos!==bytes.length)return false;
  const passes:Pass[]=interlace===0?[{width,height}]:
    ADAM7.map(([x,y,dx,dy])=>({
      width:passLength(width,x,dx),height:passLength(height,y,dy),
    })).filter(p=>p.width>0&&p.height>0);
  const bitsPerPixel=depth*channels;
  const bytesPerPixel=Math.max(1,Math.ceil(bitsPerPixel/8));
  let expected=0;
  for(const pass of passes){
    const scanlineBytes=Math.ceil(pass.width*bitsPerPixel/8);
    expected+=(scanlineBytes+1)*pass.height;
    if(!Number.isSafeInteger(expected)||expected>PNG_RASTER_LIMIT)return false;
  }
  if(expected===0)return false;
  const compressed=new Uint8Array(compressedLength);
  let offset=0;
  for(const chunk of blocks){compressed.set(chunk,offset);offset+=chunk.length;}
  try{
    const pixels=unzlibSync(compressed,{out:new Uint8Array(expected)});
    if(pixels.length!==expected)return false;
    let index=0;
    for(const pass of passes){
      const rowSize=Math.ceil(pass.width*bitsPerPixel/8);
      let above=new Uint8Array(rowSize);
      for(let y=0;y<pass.height;y++){
        const filter=pixels[index++];
        if(filter>4)return false;
        const row=new Uint8Array(rowSize);
        for(let x=0;x<rowSize;x++){
          const raw=pixels[index++];
          const left=x>=bytesPerPixel?row[x-bytesPerPixel]:0;
          const up=above[x];
          const topLeft=x>=bytesPerPixel?above[x-bytesPerPixel]:0;
          const prediction=filter===1?left:filter===2?up:
            filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,topLeft):0;
          row[x]=(raw+prediction)&255;
        }
        if(color===3){
          for(let x=0;x<pass.width;x++){
            const bit=x*depth;
            const paletteIndex=(row[bit>>3]>>(8-depth-(bit&7)))&((1<<depth)-1);
            if(paletteIndex>=paletteEntries)return false;
          }
        }
        above=row;
      }
    }
    return index===expected;
  }catch{
    return false;
  }
}
