import {unzipSync,zipSync} from 'fflate';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {exportPdfPagesAsPngZip,type PdfPngExportOptions,type PdfPagePng} from './pageImageExport';
import {validatePngRaster} from './pngIntegrity';

/**
 * Offline, rasterized PDF -> PowerPoint OpenXML. Every slide contains one
 * rendered page as an image. It preserves visual appearance and page order,
 * but deliberately does not claim editable vector/text reconstruction.
 */
export const PDF_SLIDES_MAX_PAGES=50;
export const PDF_SLIDES_MAX_SOURCE_BYTES=32*1024*1024;
export const PDF_SLIDES_MAX_OUTPUT_BYTES=34*1024*1024;
export const PDF_SLIDES_MAX_PIXELS=16_000_000;
const CX=9_144_000,CY=6_858_000;
const utf8=(s:string)=>new TextEncoder().encode(s);
const decode=(b:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(b);
const contentType='application/vnd.openxmlformats-officedocument.presentationml.';

function abortIfNeeded(signal?:AbortSignal):void{
  if(signal?.aborted){
    const error=new Error('PDF presentation export cancelled.');
    error.name='AbortError';throw error;
  }
}
function pngDimensions(bytes:Uint8Array):{width:number;height:number}{
  if(!validatePngRaster(bytes))throw new Error('Presentation page contains a damaged PNG raster.');
  const u32=(at:number)=>(bytes[at]*0x1000000+bytes[at+1]*65536+bytes[at+2]*256+bytes[at+3])>>>0;
  const width=u32(16),height=u32(20);
  if(!width||!height||width*height>PDF_SLIDES_MAX_PIXELS){
    throw new Error('Presentation page exceeds the 16 megapixel limit.');
  }
  return {width,height};
}
const spTree='<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'+
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'+
  '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const ns='xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '+
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '+
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const relsNS='http://schemas.openxmlformats.org/package/2006/relationships';
const officeRel='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

function imageSlide(index:number,width:number,height:number):string{
  const fraction=Math.min(CX/width,CY/height);
  const w=Math.max(1,Math.floor(width*fraction));
  const h=Math.max(1,Math.floor(height*fraction));
  const x=Math.floor((CX-w)/2),y=Math.floor((CY-h)/2);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<p:sld '+ns+'><p:cSld><p:spTree>'+spTree+
    '<p:pic><p:nvPicPr><p:cNvPr id="2" name="PDF page '+index+
    '" descr="Rasterized PDF page '+index+'"/>'+
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'+
    '<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'+
    '<p:spPr><a:xfrm><a:off x="'+x+'" y="'+y+'"/><a:ext cx="'+w+'" cy="'+h+'"/></a:xfrm>'+
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'+
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}
function contentTypes(count:number):string{
  let overrides='<Override PartName="/ppt/presentation.xml" ContentType="'+contentType+'main+xml"/>'+
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="'+contentType+'slideMaster+xml"/>'+
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="'+contentType+'slideLayout+xml"/>'+
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>';
  for(let i=1;i<=count;i++)overrides+='<Override PartName="/ppt/slides/slide'+i+'.xml" ContentType="'+contentType+'slide+xml"/>';
  return '<?xml version="1.0" encoding="UTF-8"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Default Extension="png" ContentType="image/png"/>'+overrides+'</Types>';
}
function presentation(count:number):string{
  let slides='';
  for(let i=1;i<=count;i++)slides+='<p:sldId id="'+(255+i)+'" r:id="rId'+(i+1)+'"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<p:presentation '+ns+'><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'+
    '<p:sldIdLst>'+slides+'</p:sldIdLst><p:sldSz cx="'+CX+'" cy="'+CY+
    '" type="screen4x3"/><p:notesSz cx="'+CY+'" cy="'+CX+'"/></p:presentation>';
}
function presentationRels(count:number):string{
  let records='<Relationship Id="rId1" Type="'+officeRel+'slideMaster" Target="slideMasters/slideMaster1.xml"/>';
  for(let i=1;i<=count;i++){
    records+='<Relationship Id="rId'+(i+1)+'" Type="'+officeRel+'slide" Target="slides/slide'+i+'.xml"/>';
  }
  return '<Relationships xmlns="'+relsNS+'">'+records+'</Relationships>';
}
const master='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<p:sldMaster '+ns+'><p:cSld name="MALENJO Raster Master"><p:spTree>'+spTree+
  '</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" '+
  'accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" '+
  'folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>'+
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'+
  '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';
const layout='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<p:sldLayout '+ns+' type="blank" preserve="1"><p:cSld name="Blank">'+
  '<p:spTree>'+spTree+'</p:spTree></p:cSld>'+
  '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
const theme='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="MALENJO">'+
  '<a:themeElements><a:clrScheme name="Neutral">'+
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'+
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'+
  '<a:dk2><a:srgbClr val="333333"/></a:dk2><a:lt2><a:srgbClr val="EAEAEA"/></a:lt2>'+
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>'+
  '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>'+
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>'+
  '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>'+
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>'+
  '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>'+
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>'+
  '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'+
  '<a:fontScheme name="MALENJO"><a:majorFont><a:latin typeface="Arial"/></a:majorFont>'+
  '<a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>'+
  '<a:fmtScheme name="MALENJO"><a:fillStyleLst><a:solidFill><a:schemeClr val="accent1"/></a:solidFill>'+
  '<a:solidFill><a:schemeClr val="accent2"/></a:solidFill>'+
  '<a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:fillStyleLst>'+
  '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln>'+
  '<a:ln w="12700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln>'+
  '<a:ln w="19050"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:lnStyleLst>'+
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>'+
  '<a:effectStyle><a:effectLst/></a:effectStyle>'+
  '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'+
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill>'+
  '<a:solidFill><a:schemeClr val="lt2"/></a:solidFill>'+
  '<a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:bgFillStyleLst>'+
  '</a:fmtScheme></a:themeElements></a:theme>';

function packaged(entries:PdfPagePng[],signal?:AbortSignal):Uint8Array{
  if(!entries.length||entries.length>PDF_SLIDES_MAX_PAGES){
    throw new Error('PDF presentation requires 1 to 50 image pages.');
  }
  const files:Record<string,Uint8Array>={};
  files['[Content_Types].xml']=utf8(contentTypes(entries.length));
  files['_rels/.rels']=utf8('<Relationships xmlns="'+relsNS+'">'+
    '<Relationship Id="rId1" Type="'+officeRel+'officeDocument" Target="ppt/presentation.xml"/>'+
    '</Relationships>');
  files['ppt/presentation.xml']=utf8(presentation(entries.length));
  files['ppt/_rels/presentation.xml.rels']=utf8(presentationRels(entries.length));
  files['ppt/slideMasters/slideMaster1.xml']=utf8(master);
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels']=utf8('<Relationships xmlns="'+relsNS+'">'+
    '<Relationship Id="rId1" Type="'+officeRel+'slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'+
    '<Relationship Id="rId2" Type="'+officeRel+'theme" Target="../theme/theme1.xml"/>'+
    '</Relationships>');
  files['ppt/slideLayouts/slideLayout1.xml']=utf8(layout);
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels']=utf8('<Relationships xmlns="'+relsNS+'">'+
    '<Relationship Id="rId1" Type="'+officeRel+'slideMaster" Target="../slideMasters/slideMaster1.xml"/>'+
    '</Relationships>');
  files['ppt/theme/theme1.xml']=utf8(theme);
  let total=0;
  for(let index=0;index<entries.length;index++){
    abortIfNeeded(signal);
    const item=entries[index];
    if(item.pageNumber!==index+1||item.bytes.length>12*1024*1024){
      throw new Error('PDF presentation requires ordered PNGs smaller than 12 MB.');
    }
    total+=item.bytes.length;
    if(total>PDF_SLIDES_MAX_SOURCE_BYTES){
      throw new Error('PDF presentation exceeds the 32 MB image budget.');
    }
    const {width,height}=pngDimensions(item.bytes),i=index+1;
    files['ppt/media/image'+i+'.png']=item.bytes;
    files['ppt/slides/slide'+i+'.xml']=utf8(imageSlide(i,width,height));
    files['ppt/slides/_rels/slide'+i+'.xml.rels']=utf8('<Relationships xmlns="'+relsNS+'">'+
      '<Relationship Id="rId1" Type="'+officeRel+'image" Target="../media/image'+i+'.png"/>'+
      '<Relationship Id="rId2" Type="'+officeRel+'slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'+
      '</Relationships>');
  }
  const archive=zipSync(files,{level:0});
  if(archive.length>PDF_SLIDES_MAX_OUTPUT_BYTES){
    throw new Error('PowerPoint archive exceeds the 34 MB export budget.');
  }
  abortIfNeeded(signal);
  return archive;
}
export function serializePdfRasterPptx(pages:PdfPagePng[],signal?:AbortSignal):Uint8Array{
  return packaged(pages,signal);
}
/** Verify the OpenXML manifest, relationships, and every raster image. */
export function inspectPdfRasterPptx(bytes:Uint8Array):{slideCount:number;imagesValid:boolean}{
  if(bytes.length<100||bytes.length>PDF_SLIDES_MAX_OUTPUT_BYTES){
    throw new Error('PowerPoint archive is empty or too large.');
  }
  let extracted=0,files:Record<string,Uint8Array>;
  try{
    files=unzipSync(bytes,{filter:(entry)=>{
      if(entry.originalSize>PDF_SLIDES_MAX_OUTPUT_BYTES-extracted){
        throw new Error('PowerPoint decompression exceeds the 34 MB inspection budget.');
      }
      if(entry.name.startsWith('/')||entry.name.includes('\\')||
         entry.name.split('/').some(part=>part==='..'||part==='.')||
         /[\u0000-\u001f]/.test(entry.name)){
        throw new Error('PowerPoint contains an unsafe package path.');
      }
      extracted+=entry.originalSize;
      return true;
    }});
  }catch(error){
    throw new Error('PowerPoint package is invalid or unsafe: '+(error instanceof Error?error.message:String(error)));
  }
  const count=Object.keys(files).filter(k=>/^ppt\/slides\/slide[1-9]\d*\.xml$/.test(k)).length;
  if(!count||count>PDF_SLIDES_MAX_PAGES||Object.keys(files).length!==9+3*count){
    throw new Error('PowerPoint package has missing or unexpected parts.');
  }
  const pkg=decode(files['[Content_Types].xml']??new Uint8Array());
  const manifest=decode(files['ppt/presentation.xml']??new Uint8Array());
  if(!pkg.includes('presentationml.presentation.main+xml')||
     !manifest.includes('<p:sldIdLst>')||
     !decode(files['_rels/.rels']??new Uint8Array()).includes('Target="ppt/presentation.xml"')){
    throw new Error('PowerPoint package manifest or presentation relationship is missing.');
  }
  for(let i=1;i<=count;i++){
    const slide=files['ppt/slides/slide'+i+'.xml'];
    const rels=files['ppt/slides/_rels/slide'+i+'.xml.rels'];
    const image=files['ppt/media/image'+i+'.png'];
    if(!slide||!rels||!image||
       !decode(slide).includes('r:embed="rId1"')||
       !decode(rels).includes('Target="../media/image'+i+'.png"')||
       !pngDimensions(image)){
      throw new Error('PowerPoint slide '+i+' is missing its validated image.');
    }
  }
  return {slideCount:count,imagesValid:true};
}
export async function exportPdfRasterPptx(
  document:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:PdfPngExportOptions={},
):Promise<Uint8Array>{
  abortIfNeeded(options.signal);
  const zip=await exportPdfPagesAsPngZip(document,options);
  abortIfNeeded(options.signal);
  if(zip.byteLength>PDF_SLIDES_MAX_SOURCE_BYTES){
    throw new Error('Rendered slides exceed the 32 MB PowerPoint image budget.');
  }
  const images=unzipSync(zip);
  const pages=Object.entries(images).map(([name,bytes])=>({
    pageNumber:Number(/^page-(\d{4})\.png$/.exec(name)?.[1]??0),bytes,
  })).sort((a,b)=>a.pageNumber-b.pageNumber);
  if(pages.length!==document.numPages){
    throw new Error('PowerPoint render did not produce every PDF page.');
  }
  const result=serializePdfRasterPptx(pages,options.signal);
  const verified=inspectPdfRasterPptx(result);
  if(verified.slideCount!==document.numPages){
    throw new Error('PowerPoint export failed slide-count verification.');
  }
  return result;
}
