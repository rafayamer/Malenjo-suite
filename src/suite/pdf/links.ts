import {
  PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFRef,PDFString,
} from 'pdf-lib';

export type PdfLinkTarget =
  |{kind:'page';pageNumber:number}
  |{kind:'https';url:string};
export interface PdfLinkAnnotation {
  pageNumber:number;
  index:number;
  ref:string|null;
  kind:'page'|'https'|'unsupported';
  destination:string;
}
export interface PdfLinkRectangle {
  pageNumber:number;x:number;y:number;width:number;height:number;
}
export type PdfLinkRef=Pick<PdfLinkAnnotation,'pageNumber'|'index'|'ref'>;

const ANN=PDFName.of('Annots');
const SUBTYPE=PDFName.of('Subtype');
const ACT=PDFName.of('A');
const DEST=PDFName.of('Dest');
const URI=PDFName.of('URI');
const PARENT=PDFName.of('P');
const MAX_PAGES=2000;
const MAX_ANNOTATIONS=4000;
const MAX_LINKS=1000;

async function load(bytes:Uint8Array):Promise<PDFDocument>{
  if(!bytes.byteLength)throw new Error('PDF is empty.');
  return PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
}
async function save(pdf:PDFDocument):Promise<Uint8Array>{
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
function validHttps(value:string):string{
  if(typeof value!=='string'||value.length>2000||
      !/^https:\/\//i.test(value)||/[\u0000-\u0020\u007F\\]/.test(value)){
    throw new Error('Use an HTTPS URL without credentials, spaces or control characters (maximum 2,000 characters).');
  }
  let url:URL;
  try{url=new URL(value);}catch{throw new Error('The HTTPS URL is malformed.');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password){
    throw new Error('Only HTTPS links without embedded credentials are allowed.');
  }
  if(url.href.length>2000)throw new Error('HTTPS URL is too long.');
  return url.href;
}
function targetCheck(pdf:PDFDocument,target:PdfLinkTarget):void{
  if(target?.kind==='https'){validHttps(target.url);return;}
  if(target?.kind==='page'&&Number.isSafeInteger(target.pageNumber)&&
     target.pageNumber>=1&&target.pageNumber<=pdf.getPageCount())return;
  throw new Error('Choose an existing target page or a valid HTTPS URL.');
}
function rectCheck(pdf:PDFDocument,rect:PdfLinkRectangle):void{
  if(!Number.isSafeInteger(rect.pageNumber)||rect.pageNumber<1||rect.pageNumber>pdf.getPageCount()){
    throw new Error('Link annotation page is outside the PDF.');
  }
  if([rect.x,rect.y,rect.width,rect.height].some(x=>!Number.isFinite(x)||x<0||x>1)||
     rect.width<=0||rect.height<=0||rect.x+rect.width>1||rect.y+rect.height>1){
    throw new Error('Link rectangle must be nonempty and inside the PDF page.');
  }
}
function annotationList(pdf:PDFDocument,pageNumber:number):PDFArray|undefined{
  if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>pdf.getPageCount()){
    throw new Error('Link page no longer exists.');
  }
  return pdf.getPage(pageNumber-1).node.lookupMaybe(ANN,PDFArray);
}
function requireLinked(pdf:PDFDocument,target:PdfLinkRef):{annots:PDFArray;dict:PDFDict}{
  if(target.ref===null||typeof target.ref!=='string')throw new Error('Only indirect link annotations can be edited.');
  const annots=annotationList(pdf,target.pageNumber);
  if(!annots||!Number.isSafeInteger(target.index)||target.index<0||target.index>=annots.size()){
    throw new Error('Selected PDF link no longer exists.');
  }
  const ref=annots.get(target.index);
  if(!(ref instanceof PDFRef)||ref.toString()!==target.ref){
    throw new Error('PDF link identity changed; refresh the link list.');
  }
  const dict=pdf.context.lookup(ref,PDFDict);
  if(dict.get(SUBTYPE)?.toString()!=='/Link'){
    throw new Error('Selected PDF annotation is no longer a link.');
  }
  return {annots,dict};
}
function destination(pdf:PDFDocument,dict:PDFDict):{
  kind:PdfLinkAnnotation['kind'];destination:string
}{
  const action=dict.lookupMaybe(ACT,PDFDict);
  const type=action?.get(PDFName.of('S'))?.toString();
  if(type==='/URI'){
    const uri=action?.get(URI);
    if(uri instanceof PDFHexString||uri instanceof PDFString){
      const value=uri.decodeText();
      try{return {kind:'https',destination:validHttps(value)};}catch{
        return {kind:'unsupported',destination:'Unsupported or unsafe external URL action'};
      }
    }
  }
  if(action && type && type!=='/GoTo'){
    return {kind:'unsupported',destination:'Unsupported document action '+type};
  }
  const dest=dict.get(DEST)??action?.get(PDFName.of('D'));
  if(dest instanceof PDFArray && dest.size()>0){
    const pageRef=dest.get(0);
    if(pageRef instanceof PDFRef){
      const page=pdf.getPages().findIndex(p=>p.ref.toString()===pageRef.toString());
      if(page>=0)return {kind:'page',destination:String(page+1)};
    }
  }
  return {kind:'unsupported',destination:'Named or unsupported PDF destination'};
}
function assignTarget(pdf:PDFDocument,dict:PDFDict,target:PdfLinkTarget):void{
  targetCheck(pdf,target);
  dict.delete(DEST);
  if(target.kind==='page'){
    const page=pdf.getPage(target.pageNumber-1);
    dict.set(DEST,pdf.context.obj([page.ref,PDFName.of('Fit')]));
    dict.delete(ACT);
  }else{
    dict.set(ACT,pdf.context.obj({
      S:PDFName.of('URI'),
      URI:PDFHexString.fromText(validHttps(target.url)),
    }));
  }
}

export async function listPdfLinkAnnotations(bytes:Uint8Array):Promise<PdfLinkAnnotation[]>{
  const pdf=await load(bytes);
  if(pdf.getPageCount()>MAX_PAGES)throw new Error('PDF link inventory supports at most 2,000 pages.');
  const found:PdfLinkAnnotation[]=[];
  let visited=0;
  for(let pageNumber=1;pageNumber<=pdf.getPageCount();pageNumber++){
    const annots=annotationList(pdf,pageNumber);
    if(!annots)continue;
    visited+=annots.size();
    if(visited>MAX_ANNOTATIONS)throw new Error('PDF has too many annotations for a complete link inventory.');
    for(let index=0;index<annots.size();index++){
      const ref=annots.get(index);
      let dict:PDFDict;
      try{dict=pdf.context.lookup(ref,PDFDict);}catch{continue;}
      if(dict.get(SUBTYPE)?.toString()!=='/Link')continue;
      if(found.length>=MAX_LINKS)throw new Error('PDF link inventory exceeds 1,000 links; no incomplete list was returned.');
      found.push({
        pageNumber,index,ref:ref instanceof PDFRef?ref.toString():null,
        ...destination(pdf,dict),
      });
    }
  }
  return found;
}

export async function addPdfLinkAnnotation(
  bytes:Uint8Array,rect:PdfLinkRectangle,target:PdfLinkTarget,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  rectCheck(pdf,rect);
  targetCheck(pdf,target);
  const page=pdf.getPage(rect.pageNumber-1);
  const [w,h]=[page.getSize().width,page.getSize().height];
  const annots=annotationList(pdf,rect.pageNumber)??pdf.context.obj([]);
  if(annots.size()>=MAX_ANNOTATIONS)throw new Error('Page exceeds link annotation safety limits.');
  const dict=pdf.context.obj({
    Type:PDFName.of('Annot'),Subtype:PDFName.of('Link'),P:page.ref,
    Rect:[rect.x*w,rect.y*h,(rect.x+rect.width)*w,(rect.y+rect.height)*h],
    Border:[0,0,1],
    H:PDFName.of('I'),
    F:4,
  });
  assignTarget(pdf,dict,target);
  annots.push(pdf.context.register(dict));
  if(!page.node.has(ANN))page.node.set(ANN,annots);
  return save(pdf);
}

export async function updatePdfLinkAnnotation(
  bytes:Uint8Array,link:PdfLinkRef,target:PdfLinkTarget,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const {dict}=requireLinked(pdf,link);
  targetCheck(pdf,target);
  const current=destination(pdf,dict);
  if(current.kind==='unsupported'){
    throw new Error('Unsupported imported link actions cannot be overwritten by this editor.');
  }
  assignTarget(pdf,dict,target);
  return save(pdf);
}

export async function deletePdfLinkAnnotation(
  bytes:Uint8Array,link:PdfLinkRef,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const {annots}=requireLinked(pdf,link);
  annots.remove(link.index);
  return save(pdf);
}
