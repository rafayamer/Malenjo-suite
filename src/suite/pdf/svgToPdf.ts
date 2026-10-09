import {PDFDocument,PDFName,rgb,type Color} from 'pdf-lib';

/**
 * Offline SVG vector primitives -> actual PDF vector content.
 * No XML parser/network/HTML execution, external assets, scripts, CSS,
 * filters, fonts, nested SVG trees or DTDs. Only an explicit, bounded,
 * self-closing path/rect/circle/ellipse/line subset is accepted.
 * Unsupported SVG is rejected, not silently rendered incorrectly.
 */
export const SVG_TO_PDF_MAX_INPUT_BYTES=2*1024*1024;
export const SVG_TO_PDF_MAX_OUTPUT_BYTES=16*1024*1024;
export const SVG_TO_PDF_MAX_SHAPES=2000;
const MAX_SVG_DIMENSION=19200;
type SvgShape={tag:string;attrs:Record<string,string>};
const NUMBER=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const numeric=(v:string|undefined,name:string,defaultValue?:number):number=>{
  if(v===undefined){
    if(defaultValue!==undefined)return defaultValue;
    throw new Error('SVG '+name+' attribute is required.');
  }
  if(!NUMBER.test(v.trim()))throw new Error('SVG '+name+' must be a finite number.');
  const n=Number(v);
  if(!Number.isFinite(n)||Math.abs(n)>MAX_SVG_DIMENSION*100){
    throw new Error('SVG '+name+' exceeds numeric safety limits.');
  }
  return n;
};
function parseAttributes(source:string,allowed:readonly string[]):Record<string,string>{
  const result:Record<string,string>={};
  const re=/\s+([a-zA-Z][\w:.-]*)\s*=\s*"([^"]*)"/gy;
  let position=0;
  while(position<source.length){
    re.lastIndex=position;
    const match=re.exec(source);
    if(!match){
      if(!source.slice(position).trim())break;
      throw new Error('SVG has unsupported attribute syntax or unquoted values.');
    }
    const name=match[1];
    if(!allowed.includes(name)||name in result){
      throw new Error('SVG contains an unsupported or duplicated '+name+' attribute.');
    }
    if(match[2].length>8192||/[&<>\u0000-\u001f]/.test(match[2])){
      throw new Error('SVG attribute contains unsafe XML or control characters.');
    }
    result[name]=match[2];
    position=re.lastIndex;
  }
  return result;
}
function parseSvg(source:Uint8Array):{width:number;height:number;view:[number,number,number,number];shapes:SvgShape[]}{
  if(!(source instanceof Uint8Array)||source.byteLength<10||
     source.byteLength>SVG_TO_PDF_MAX_INPUT_BYTES){
    throw new Error('SVG to PDF accepts a local SVG file of at most 2 MB.');
  }
  let xml:string;
  try{xml=new TextDecoder('utf-8',{fatal:true}).decode(source).trim();}
  catch{throw new Error('SVG source must use valid UTF-8.');}
  xml=xml.replace(/^<\?xml\s+version="1\.0"(?:\s+encoding="UTF-8")?\s*\?>\s*/i,'');
  if(/<!|<\?|<!--|-->|<!DOCTYPE|<!ENTITY/i.test(xml)){
    throw new Error('SVG XML declarations, DTDs and comments are not supported.');
  }
  const root=/^<svg([^<>]*)>([\s\S]*)<\/svg>$/.exec(xml);
  if(!root)throw new Error('SVG needs a single SVG root and self-closing vector shapes.');
  const attrs=parseAttributes(root[1],['xmlns','width','height','viewBox','version']);
  if(attrs.xmlns!==undefined&&attrs.xmlns!=='http://www.w3.org/2000/svg'){
    throw new Error('SVG namespace is not supported.');
  }
  const dimension=(v:string|undefined,key:string):number=>{
    if(v===undefined)throw new Error('SVG '+key+' is required.');
    const value=v.replace(/px$/i,'');
    const n=numeric(value,key);
    if(n<1||n>MAX_SVG_DIMENSION)throw new Error('SVG dimensions must be between 1 and 19,200 pixels.');
    return n;
  };
  const width=dimension(attrs.width,'width'),height=dimension(attrs.height,'height');
  let view:[number,number,number,number]=[0,0,width,height];
  if(attrs.viewBox!==undefined){
    const components=attrs.viewBox.trim().split(/[\s,]+/);
    if(components.length!==4)throw new Error('SVG viewBox needs four numbers.');
    view=components.map((s,i)=>numeric(s,'viewBox '+i)) as typeof view;
    if(view[2]<=0||view[3]<=0)throw new Error('SVG viewBox width and height must be positive.');
  }
  const shapes:SvgShape[]=[];
  const re=/<(path|rect|circle|ellipse|line)([^<>]*?)\s*\/>/g;
  const leftovers=root[2].replace(re,(_full,tag:string,raw:string)=>{
    if(shapes.length>=SVG_TO_PDF_MAX_SHAPES){
      throw new Error('SVG exceeds the 2,000-shape safety limit.');
    }
    const common=['fill','stroke','stroke-width','opacity'];
    const allowed=tag==='path'?[...common,'d']:
      tag==='rect'?[...common,'x','y','width','height']:
      tag==='circle'?[...common,'cx','cy','r']:
      tag==='ellipse'?[...common,'cx','cy','rx','ry']:
      [...common,'x1','y1','x2','y2'];
    shapes.push({tag,attrs:parseAttributes(raw,allowed)});
    return '';
  });
  if(leftovers.trim()||!shapes.length){
    throw new Error('SVG contains unsupported markup or has no vector shapes.');
  }
  return {width,height,view,shapes};
}
function paint(value:string|undefined,defaultBlack=false):Color|undefined{
  if(value===undefined){
    return defaultBlack?rgb(0,0,0):undefined;
  }
  if(value==='none')return undefined;
  const hex=/^#([a-fA-F0-9]{6})$/.exec(value);
  const short=/^#([a-fA-F0-9]{3})$/.exec(value);
  let digits=hex?.[1];
  if(short)digits=short[1].split('').map(c=>c+c).join('');
  if(!digits)throw new Error('SVG colors must be #RGB, #RRGGBB or none.');
  return rgb(parseInt(digits.slice(0,2),16)/255,
    parseInt(digits.slice(2,4),16)/255,
    parseInt(digits.slice(4,6),16)/255);
}
function style(attrs:Record<string,string>,isLine=false){
  const color=paint(attrs.fill,!isLine);
  const borderColor=paint(attrs.stroke);
  const borderWidth=numeric(attrs['stroke-width'],'stroke-width',1);
  const opacity=numeric(attrs.opacity,'opacity',1);
  if(borderWidth<0||borderWidth>100||opacity<0||opacity>1){
    throw new Error('SVG stroke width or opacity is outside allowed bounds.');
  }
  if(isLine&&!borderColor){
    throw new Error('SVG lines require an explicit stroke color.');
  }
  return {color,borderColor,borderWidth,opacity,borderOpacity:opacity};
}
export async function convertSvgToPdf(input:Uint8Array):Promise<Uint8Array>{
  const {width,height,view,shapes}=parseSvg(input);
  const pageWidth=width*0.75,pageHeight=height*0.75;
  if(pageWidth>14400||pageHeight>14400){
    throw new Error('SVG page exceeds PDF dimensions.');
  }
  const [left,top,viewWidth,viewHeight]=view;
  const scale=Math.min(pageWidth/viewWidth,pageHeight/viewHeight);
  if(scale<=0||!Number.isFinite(scale))throw new Error('SVG scale is invalid.');
  const x=(pageWidth-viewWidth*scale)/2-left*scale;
  const y=(pageHeight-viewHeight*scale)/2+top*scale;
  const pointX=(px:number)=>x+px*scale;
  const pointY=(py:number)=>pageHeight-y-py*scale;
  const pdf=await PDFDocument.create();
  pdf.setTitle('Offline SVG vector import');
  pdf.setCreator('MALENJO vector-to-PDF');
  const page=pdf.addPage([pageWidth,pageHeight]);
  for(const {tag,attrs} of shapes){
    const opts=style(attrs,tag==='line');
    if(tag==='path'){
      const d=attrs.d;
      if(!d||d.length>8192||!/^[MLHVQCSTAZmlhvqcstaz0-9+.\-Ee,\s]+$/.test(d)){
        throw new Error('SVG path syntax is unsupported or too large.');
      }
      try{page.drawSvgPath(d,{x,y:pageHeight-y,scale,...opts});}
      catch{throw new Error('SVG path could not be rendered as PDF vector geometry.');}
    }else if(tag==='rect'){
      const rw=numeric(attrs.width,'rectangle width');
      const rh=numeric(attrs.height,'rectangle height');
      if(rw<=0||rh<=0)throw new Error('SVG rectangle dimensions must be positive.');
      const px=numeric(attrs.x,'x',0),py=numeric(attrs.y,'y',0);
      page.drawRectangle({
        x:pointX(px),y:pointY(py+rh),width:rw*scale,height:rh*scale,
        ...opts,
      });
    }else if(tag==='line'){
      page.drawLine({
        start:{x:pointX(numeric(attrs.x1,'x1')),y:pointY(numeric(attrs.y1,'y1'))},
        end:{x:pointX(numeric(attrs.x2,'x2')),y:pointY(numeric(attrs.y2,'y2'))},
        thickness:opts.borderWidth*scale,
        color:opts.borderColor,
        opacity:opts.opacity,
      });
    }else{
      const cx=numeric(attrs.cx,'cx'),cy=numeric(attrs.cy,'cy');
      const rx=numeric(tag==='circle'?attrs.r:attrs.rx,'radius x');
      const ry=numeric(tag==='circle'?attrs.r:attrs.ry,'radius y');
      if(rx<=0||ry<=0)throw new Error('SVG circle/ellipse radius must be positive.');
      page.drawEllipse({
        x:pointX(cx),y:pointY(cy),xScale:rx*scale,yScale:ry*scale,...opts,
      });
    }
  }
  const output=Uint8Array.from(await pdf.save({useObjectStreams:false}));
  if(output.length>SVG_TO_PDF_MAX_OUTPUT_BYTES){
    throw new Error('Vector PDF export exceeds the 16 MB safety limit.');
  }
  const reopened=await PDFDocument.load(output,{updateMetadata:false});
  if(reopened.getPageCount()!==1||
     Math.abs(reopened.getPage(0).getWidth()-pageWidth)>0.01){
    throw new Error('Vector PDF could not be reopened.');
  }
  return output;
}
