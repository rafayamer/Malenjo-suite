import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';

/**
 * Offline JSON -> PDF text report. No browser, Java, network or external font.
 * Data remains faithful through printable ASCII \uXXXX escapes; objects are
 * formatted as JSON, not converted into fillable PDF forms or rich charts.
 */
export const JSON_TO_PDF_MAX_INPUT_BYTES=2*1024*1024;
export const JSON_TO_PDF_MAX_CHARACTERS=500_000;
export const JSON_TO_PDF_MAX_PAGES=100;
export const JSON_TO_PDF_MAX_OUTPUT_BYTES=16*1024*1024;
const PDF_WIDTH=612,PDF_HEIGHT=792,MARGIN=42;
const CHARS_PER_LINE=99,LINES_PER_PAGE=64;

function checkJsonDepth(value:unknown):void{
  const pending:Array<{value:unknown;depth:number}>=[{value,depth:0}];
  let nodes=0;
  while(pending.length){
    const item=pending.pop()!;
    if(++nodes>100_000)throw new Error('JSON contains too many nested elements.');
    if(item.depth>64)throw new Error('JSON hierarchy exceeds 64 levels.');
    if(Array.isArray(item.value)){
      for(const entry of item.value)pending.push({value:entry,depth:item.depth+1});
    }else if(item.value&&typeof item.value==='object'){
      for(const entry of Object.values(item.value))pending.push({value:entry,depth:item.depth+1});
    }
  }
}
export function prepareJsonPdfLines(source:Uint8Array):string[]{
  if(!source.length||source.length>JSON_TO_PDF_MAX_INPUT_BYTES){
    throw new Error('JSON to PDF accepts a nonempty JSON file of at most 2 MB.');
  }
  let text:string;
  try{
    text=new TextDecoder('utf-8',{fatal:true}).decode(source);
  }catch{throw new Error('JSON to PDF requires valid UTF-8.');}
  // U+FEFF is a valid UTF-8 BOM. TextDecoder strips it for JSON.parse.
  let data:unknown;
  try{data=JSON.parse(text);}catch{throw new Error('JSON to PDF requires syntactically valid JSON.');}
  checkJsonDepth(data);
  const pretty=JSON.stringify(data,null,2);
  if(!pretty)throw new Error('JSON content is empty.');
  // PDF StandardFonts WinAnsi does not support arbitrary Unicode. Render its
  // reversible JSON \uXXXX escape representation instead of dropping glyphs.
  const ascii=pretty.replace(/[^\x20-\x7e\n]/g,(character)=>
    '\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'),
  );
  if(ascii.length>JSON_TO_PDF_MAX_CHARACTERS){
    throw new Error('JSON to PDF exceeds the 500,000-character safety limit.');
  }
  const lines:string[]=[];
  for(const line of ascii.split('\n')){
    if(!line.length){lines.push('');continue;}
    for(let offset=0;offset<line.length;offset+=CHARS_PER_LINE){
      lines.push(line.slice(offset,offset+CHARS_PER_LINE));
      if(lines.length>JSON_TO_PDF_MAX_PAGES*LINES_PER_PAGE){
        throw new Error('JSON report would exceed the 100-page PDF limit.');
      }
    }
  }
  if(lines.length>JSON_TO_PDF_MAX_PAGES*LINES_PER_PAGE){
    throw new Error('JSON report would exceed the 100-page PDF limit.');
  }
  return lines;
}
export async function convertJsonToPdf(source:Uint8Array):Promise<Uint8Array>{
  const lines=prepareJsonPdfLines(source);
  const pdf=await PDFDocument.create();
  pdf.setTitle('JSON text report');
  pdf.setCreator('MALENJO offline JSON to PDF');
  pdf.setSubject('Text-only JSON report; Unicode represented as JSON escapes');
  const font=await pdf.embedFont(StandardFonts.Courier);
  const totalPages=Math.ceil(lines.length/LINES_PER_PAGE);
  for(let pageIndex=0;pageIndex<totalPages;pageIndex++){
    const page=pdf.addPage([PDF_WIDTH,PDF_HEIGHT]);
    page.drawText('MALENJO  |  JSON report (text only)',{
      x:MARGIN,y:PDF_HEIGHT-MARGIN,size:10,font,color:rgb(0.15,0.25,0.4),
    });
    page.drawLine({start:{x:MARGIN,y:PDF_HEIGHT-MARGIN-8},
      end:{x:PDF_WIDTH-MARGIN,y:PDF_HEIGHT-MARGIN-8},thickness:0.7});
    const first=pageIndex*LINES_PER_PAGE;
    for(let index=0;index<LINES_PER_PAGE&&first+index<lines.length;index++){
      page.drawText(lines[first+index],{
        x:MARGIN,y:PDF_HEIGHT-MARGIN-30-index*10,size:8,font,
      });
    }
    page.drawText('Page '+(pageIndex+1)+' of '+totalPages,{
      x:PDF_WIDTH-MARGIN-95,y:MARGIN-10,size:9,font,
    });
  }
  const bytes=Uint8Array.from(await pdf.save());
  if(bytes.length>JSON_TO_PDF_MAX_OUTPUT_BYTES){
    throw new Error('Generated JSON PDF exceeds the 16 MB safety limit.');
  }
  return bytes;
}
