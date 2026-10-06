import {
  PDFArray,
  PDFDocument,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';

function requirePage(pageNumber:number,pageCount:number):number{
  if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>pageCount){
    throw new Error(`Page ${pageNumber} is outside the PDF page range 1-${pageCount}.`);
  }
  return pageNumber-1;
}

async function load(bytes:Uint8Array):Promise<PDFDocument>{
  if(!bytes.length) throw new Error('PDF bytes are empty.');
  return PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
}

export async function deletePdfPage(bytes:Uint8Array,pageNumber:number):Promise<Uint8Array>{
  const pdf=await load(bytes);
  if(pdf.getPageCount()<=1) throw new Error('A PDF must keep at least one page.');
  pdf.removePage(requirePage(pageNumber,pdf.getPageCount()));
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function rotatePdfPagePermanent(bytes:Uint8Array,pageNumber:number):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(pageNumber,pdf.getPageCount()));
  const current=((page.getRotation().angle%360)+360)%360;
  page.setRotation(degrees((current+90)%360));
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function duplicatePdfPage(bytes:Uint8Array,pageNumber:number):Promise<Uint8Array>{
  const source=await load(bytes);
  const index=requirePage(pageNumber,source.getPageCount());
  const output=await PDFDocument.create();
  const order=Array.from({length:source.getPageCount()+1},(_,position)=>{
    if(position<=index)return position;
    if(position===index+1)return index;
    return position-1;
  });
  const copied=await output.copyPages(source,order);
  copied.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function movePdfPage(bytes:Uint8Array,pageNumber:number,targetPageNumber:number):Promise<Uint8Array>{
  const source=await load(bytes);
  const pageCount=source.getPageCount();
  const from=requirePage(pageNumber,pageCount);
  const to=requirePage(targetPageNumber,pageCount);
  if(from===to)return Uint8Array.from(bytes);
  const order=Array.from({length:pageCount},(_,i)=>i);
  const [moved]=order.splice(from,1);
  order.splice(to,0,moved);
  const output=await PDFDocument.create();
  const copied=await output.copyPages(source,order);
  copied.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function extractPdfPage(bytes:Uint8Array,pageNumber:number):Promise<Uint8Array>{
  const source=await load(bytes);
  const index=requirePage(pageNumber,source.getPageCount());
  const output=await PDFDocument.create();
  const [page]=await output.copyPages(source,[index]);
  output.addPage(page);
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function appendPdf(bytes:Uint8Array,appendBytes:Uint8Array):Promise<Uint8Array>{
  const [source,append]=await Promise.all([load(bytes),load(appendBytes)]);
  const output=await PDFDocument.create();
  const first=await output.copyPages(source,source.getPageIndices());
  first.forEach(page=>output.addPage(page));
  const second=await output.copyPages(append,append.getPageIndices());
  second.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function insertBlankPdfPage(bytes:Uint8Array,afterPageNumber:number):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const index=requirePage(afterPageNumber,pdf.getPageCount());
  const reference=pdf.getPage(index);
  const {width,height}=reference.getSize();
  pdf.insertPage(index+1,[width,height]);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}


function requirePages(pageNumbers:number[],pageCount:number):number[]{
  const pages=Array.from(new Set(pageNumbers.map(value=>requirePage(value,pageCount)))).sort((a,b)=>a-b);
  if(!pages.length)throw new Error('Select at least one PDF page.');
  return pages;
}

export async function deletePdfPages(bytes:Uint8Array,pageNumbers:number[]):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const indices=requirePages(pageNumbers,pdf.getPageCount());
  if(indices.length>=pdf.getPageCount())throw new Error('A PDF must keep at least one page.');
  [...indices].sort((a,b)=>b-a).forEach(index=>pdf.removePage(index));
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function rotatePdfPagesPermanent(bytes:Uint8Array,pageNumbers:number[]):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const indices=requirePages(pageNumbers,pdf.getPageCount());
  for(const index of indices){
    const page=pdf.getPage(index);
    const current=((page.getRotation().angle%360)+360)%360;
    page.setRotation(degrees((current+90)%360));
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function extractPdfPages(bytes:Uint8Array,pageNumbers:number[]):Promise<Uint8Array>{
  const source=await load(bytes);
  const indices=requirePages(pageNumbers,source.getPageCount());
  const output=await PDFDocument.create();
  const copied=await output.copyPages(source,indices);
  copied.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function insertPdfAfter(bytes:Uint8Array,insertBytes:Uint8Array,afterPageNumber:number):Promise<Uint8Array>{
  const [source,insert]=await Promise.all([load(bytes),load(insertBytes)]);
  const after=requirePage(afterPageNumber,source.getPageCount());
  const output=await PDFDocument.create();
  const beforeIndices=source.getPageIndices().filter(index=>index<=after);
  const afterIndices=source.getPageIndices().filter(index=>index>after);
  const before=await output.copyPages(source,beforeIndices);
  before.forEach(page=>output.addPage(page));
  const inserted=await output.copyPages(insert,insert.getPageIndices());
  inserted.forEach(page=>output.addPage(page));
  const trailing=await output.copyPages(source,afterIndices);
  trailing.forEach(page=>output.addPage(page));
  return Uint8Array.from(await output.save({useObjectStreams:false}));
}

export async function splitPdfAtPage(bytes:Uint8Array,pageNumber:number):Promise<[Uint8Array,Uint8Array]>{
  const source=await load(bytes);
  const pageCount=source.getPageCount();
  const splitIndex=requirePage(pageNumber,pageCount);
  if(splitIndex>=pageCount-1)throw new Error('Choose a split point before the last PDF page.');

  const left=await PDFDocument.create();
  const right=await PDFDocument.create();
  const leftPages=await left.copyPages(source,Array.from({length:splitIndex+1},(_,index)=>index));
  leftPages.forEach(page=>left.addPage(page));
  const rightPages=await right.copyPages(source,Array.from({length:pageCount-splitIndex-1},(_,index)=>splitIndex+1+index));
  rightPages.forEach(page=>right.addPage(page));
  return [
    Uint8Array.from(await left.save({useObjectStreams:false})),
    Uint8Array.from(await right.save({useObjectStreams:false})),
  ];
}


function normalized(value:number,label:string):number{
  if(!Number.isFinite(value)||value<0||value>1) throw new Error(`${label} must be between 0 and 1.`);
  return value;
}

export interface PdfTextOverlay {
  pageNumber:number;
  text:string;
  x:number;
  y:number;
  size:number;
}

export interface PdfRectangleOverlay {
  pageNumber:number;
  x:number;
  y:number;
  width:number;
  height:number;
  opacity?:number;
  mode?:'highlight'|'outline';
}

export async function addPdfTextOverlay(bytes:Uint8Array,overlay:PdfTextOverlay):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(overlay.pageNumber,pdf.getPageCount()));
  const text=overlay.text.replace(/[\u0000-\u001F]/g,' ').trim().slice(0,2000);
  if(!text) throw new Error('Text overlay is empty.');
  if(!Number.isFinite(overlay.size)||overlay.size<4||overlay.size>144) throw new Error('Text size must be between 4 and 144 points.');
  const x=normalized(overlay.x,'Text X');
  const y=normalized(overlay.y,'Text Y');
  const {width,height}=page.getSize();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(text,{
    x:x*width,
    y:y*height,
    size:overlay.size,
    font,
    color:rgb(0.05,0.08,0.12),
    maxWidth:Math.max(20,width-(x*width)-12),
    lineHeight:overlay.size*1.2,
  });
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function addPdfRectangleOverlay(bytes:Uint8Array,overlay:PdfRectangleOverlay):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(overlay.pageNumber,pdf.getPageCount()));
  const x=normalized(overlay.x,'Rectangle X');
  const y=normalized(overlay.y,'Rectangle Y');
  const widthFraction=normalized(overlay.width,'Rectangle width');
  const heightFraction=normalized(overlay.height,'Rectangle height');
  if(widthFraction<=0||heightFraction<=0||x+widthFraction>1||y+heightFraction>1){
    throw new Error('Rectangle must have positive size and remain inside the page.');
  }
  const opacity=overlay.opacity??0.28;
  if(!Number.isFinite(opacity)||opacity<0.05||opacity>1) throw new Error('Rectangle opacity must be between 0.05 and 1.');
  const {width,height}=page.getSize();
  if((overlay.mode??'highlight')==='outline'){
    page.drawRectangle({
      x:x*width,y:y*height,width:widthFraction*width,height:heightFraction*height,
      borderColor:rgb(0.08,0.48,0.78),borderWidth:1.5,opacity,
    });
  }else{
    page.drawRectangle({
      x:x*width,y:y*height,width:widthFraction*width,height:heightFraction*height,
      color:rgb(1,0.88,0.18),opacity,
    });
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}


export interface PdfCommentAnnotation {
  pageNumber:number;
  text:string;
  author?:string;
  x:number;
  y:number;
}

function safeFieldName(value:string,prefix:string):string{
  const normalized=value.trim().replace(/[^A-Za-z0-9_.-]+/g,'_').slice(0,80);
  return normalized||`${prefix}_${Date.now().toString(36)}`;
}

export async function addPdfCommentAnnotation(
  bytes:Uint8Array,
  comment:PdfCommentAnnotation,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(comment.pageNumber,pdf.getPageCount()));
  const text=comment.text.replace(/[\u0000-\u001F]/g,' ').trim().slice(0,4000);
  if(!text)throw new Error('Comment text is empty.');
  const author=(comment.author??'MALENJO User').replace(/[\u0000-\u001F]/g,' ').trim().slice(0,160)||'MALENJO User';
  const x=normalized(comment.x,'Comment X');
  const y=normalized(comment.y,'Comment Y');
  const {width,height}=page.getSize();
  const left=Math.min(width-24,Math.max(0,x*width));
  const bottom=Math.min(height-24,Math.max(0,y*height));
  const annotsKey=PDFName.of('Annots');
  let annots=page.node.lookupMaybe(annotsKey,PDFArray);
  if(!annots){
    annots=pdf.context.obj([]);
    page.node.set(annotsKey,annots);
  }
  const annotation=pdf.context.obj({
    Type:PDFName.of('Annot'),
    Subtype:PDFName.of('Text'),
    Rect:[left,bottom,left+22,bottom+22],
    Contents:text,
    T:author,
    Name:PDFName.of('Comment'),
    C:[1,0.82,0.16],
    F:4,
    Open:false,
  });
  annots.push(pdf.context.register(annotation));
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export interface PdfFieldFlags {
  required?:boolean;
  readOnly?:boolean;
}

function applyFieldFlags(
  field:{enableRequired():void;enableReadOnly():void},
  flags:PdfFieldFlags,
):void{
  if(flags.required)field.enableRequired();
  if(flags.readOnly)field.enableReadOnly();
}

function cleanFieldOptions(values:string[],minimum=1):string[]{
  const options=Array.from(new Set(
    values
      .map((value)=>value.replace(/[\u0000-\u001F]/g,' ').trim().slice(0,120))
      .filter(Boolean),
  )).slice(0,50);
  if(options.length<minimum)throw new Error(`Provide at least ${minimum} unique non-empty form option(s).`);
  return options;
}

export interface PdfTextFieldSpec extends PdfFieldFlags {
  pageNumber:number;
  name:string;
  x:number;
  y:number;
  width:number;
  height:number;
  defaultValue?:string;
}

export async function addPdfTextField(bytes:Uint8Array,spec:PdfTextFieldSpec):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(spec.pageNumber,pdf.getPageCount()));
  const x=normalized(spec.x,'Field X');
  const y=normalized(spec.y,'Field Y');
  const widthFraction=normalized(spec.width,'Field width');
  const heightFraction=normalized(spec.height,'Field height');
  if(widthFraction<=0||heightFraction<=0||x+widthFraction>1||y+heightFraction>1){
    throw new Error('Form field must have positive size and remain inside the page.');
  }
  const form=pdf.getForm();
  const name=safeFieldName(spec.name,'text');
  if(form.getFieldMaybe(name))throw new Error(`A form field named "${name}" already exists.`);
  const field=form.createTextField(name);
  if(spec.defaultValue)field.setText(spec.defaultValue.slice(0,2000));
  applyFieldFlags(field,spec);
  const {width,height}=page.getSize();
  field.addToPage(page,{
    x:x*width,
    y:y*height,
    width:widthFraction*width,
    height:heightFraction*height,
    borderWidth:1,
    borderColor:rgb(0.08,0.32,0.56),
    backgroundColor:rgb(0.98,0.99,1),
    textColor:rgb(0.05,0.08,0.12),
  });
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export interface PdfCheckBoxSpec extends PdfFieldFlags {
  pageNumber:number;
  name:string;
  x:number;
  y:number;
  size:number;
  checked?:boolean;
}

export async function addPdfCheckBox(bytes:Uint8Array,spec:PdfCheckBoxSpec):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(spec.pageNumber,pdf.getPageCount()));
  const x=normalized(spec.x,'Checkbox X');
  const y=normalized(spec.y,'Checkbox Y');
  const size=normalized(spec.size,'Checkbox size');
  if(size<=0||x+size>1||y+size>1)throw new Error('Checkbox must remain inside the page.');
  const form=pdf.getForm();
  const name=safeFieldName(spec.name,'check');
  if(form.getFieldMaybe(name))throw new Error(`A form field named "${name}" already exists.`);
  const field=form.createCheckBox(name);
  const {width,height}=page.getSize();
  const points=Math.max(10,Math.min(width,height)*size);
  field.addToPage(page,{
    x:x*width,
    y:y*height,
    width:points,
    height:points,
    borderWidth:1,
    borderColor:rgb(0.08,0.32,0.56),
    backgroundColor:rgb(0.98,0.99,1),
  });
  if(spec.checked)field.check();
  applyFieldFlags(field,spec);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export interface PdfRadioGroupSpec extends PdfFieldFlags {
  pageNumber:number;
  name:string;
  options:string[];
  selected?:string;
  x:number;
  y:number;
  size:number;
  gap?:number;
}

export async function addPdfRadioGroup(bytes:Uint8Array,spec:PdfRadioGroupSpec):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(spec.pageNumber,pdf.getPageCount()));
  const x=normalized(spec.x,'Radio X');
  const y=normalized(spec.y,'Radio Y');
  const size=normalized(spec.size,'Radio size');
  const gap=normalized(spec.gap??0.075,'Radio gap');
  const options=cleanFieldOptions(spec.options,2);
  const form=pdf.getForm();
  const name=safeFieldName(spec.name,'radio');
  if(form.getFieldMaybe(name))throw new Error(`A form field named "${name}" already exists.`);
  const field=form.createRadioGroup(name);
  const {width,height}=page.getSize();
  const points=Math.max(10,Math.min(width,height)*size);
  const gapPoints=Math.max(points+6,height*gap);
  const startX=x*width;
  const startY=y*height;
  if(startX+points>width||startY+points>height||startY-(options.length-1)*gapPoints<0){
    throw new Error('Radio-group options must remain inside the page.');
  }
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  options.forEach((option,index)=>{
    const optionY=startY-index*gapPoints;
    field.addOptionToPage(option,page,{
      x:startX,
      y:optionY,
      width:points,
      height:points,
      borderWidth:1,
      borderColor:rgb(0.08,0.32,0.56),
      backgroundColor:rgb(0.98,0.99,1),
    });
    page.drawText(option,{
      x:Math.min(width-10,startX+points+6),
      y:optionY+Math.max(0,(points-9)/2),
      size:9,
      font,
      color:rgb(0.08,0.12,0.16),
      maxWidth:Math.max(20,width-startX-points-12),
    });
  });
  if(spec.selected){
    if(!options.includes(spec.selected))throw new Error('Selected radio value must exist in the radio options.');
    field.select(spec.selected);
  }
  applyFieldFlags(field,spec);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export interface PdfChoiceFieldSpec extends PdfFieldFlags {
  pageNumber:number;
  name:string;
  options:string[];
  selected?:string[];
  x:number;
  y:number;
  width:number;
  height:number;
  multiselect?:boolean;
}

function validateChoiceBox(
  page:{getSize():{width:number;height:number}},
  spec:PdfChoiceFieldSpec,
):{x:number;y:number;widthFraction:number;heightFraction:number;width:number;height:number}{
  const x=normalized(spec.x,'Choice X');
  const y=normalized(spec.y,'Choice Y');
  const widthFraction=normalized(spec.width,'Choice width');
  const heightFraction=normalized(spec.height,'Choice height');
  if(widthFraction<=0||heightFraction<=0||x+widthFraction>1||y+heightFraction>1){
    throw new Error('Choice field must have positive size and remain inside the page.');
  }
  const {width,height}=page.getSize();
  return {x,y,widthFraction,heightFraction,width,height};
}

export async function addPdfDropdown(bytes:Uint8Array,spec:PdfChoiceFieldSpec):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(spec.pageNumber,pdf.getPageCount()));
  const box=validateChoiceBox(page,spec);
  const options=cleanFieldOptions(spec.options,1);
  const form=pdf.getForm();
  const name=safeFieldName(spec.name,'dropdown');
  if(form.getFieldMaybe(name))throw new Error(`A form field named "${name}" already exists.`);
  const field=form.createDropdown(name);
  field.addOptions(options);
  if(spec.multiselect)field.enableMultiselect();
  const selected=(spec.selected??[]).filter((value)=>options.includes(value));
  if(selected.length){
    field.select(spec.multiselect ? selected : selected[0]);
  }
  applyFieldFlags(field,spec);
  field.addToPage(page,{
    x:box.x*box.width,
    y:box.y*box.height,
    width:box.widthFraction*box.width,
    height:box.heightFraction*box.height,
    borderWidth:1,
    borderColor:rgb(0.08,0.32,0.56),
    backgroundColor:rgb(0.98,0.99,1),
    textColor:rgb(0.05,0.08,0.12),
  });
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function addPdfOptionList(bytes:Uint8Array,spec:PdfChoiceFieldSpec):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(spec.pageNumber,pdf.getPageCount()));
  const box=validateChoiceBox(page,spec);
  const options=cleanFieldOptions(spec.options,1);
  const form=pdf.getForm();
  const name=safeFieldName(spec.name,'list');
  if(form.getFieldMaybe(name))throw new Error(`A form field named "${name}" already exists.`);
  const field=form.createOptionList(name);
  field.addOptions(options);
  if(spec.multiselect)field.enableMultiselect();
  const selected=(spec.selected??[]).filter((value)=>options.includes(value));
  if(selected.length)field.select(spec.multiselect ? selected : selected[0]);
  applyFieldFlags(field,spec);
  field.addToPage(page,{
    x:box.x*box.width,
    y:box.y*box.height,
    width:box.widthFraction*box.width,
    height:box.heightFraction*box.height,
    borderWidth:1,
    borderColor:rgb(0.08,0.32,0.56),
    backgroundColor:rgb(0.98,0.99,1),
    textColor:rgb(0.05,0.08,0.12),
  });
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function flattenPdfForm(bytes:Uint8Array):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const form=pdf.getForm();
  if(!form.getFields().length)throw new Error('This PDF contains no AcroForm fields to flatten.');
  form.flatten();
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function listPdfFormFields(bytes:Uint8Array):Promise<string[]>{
  const pdf=await load(bytes);
  return pdf.getForm().getFields().map((field)=>field.getName());
}

export interface PdfFormFieldInfo {
  name:string;
  type:string;
  required:boolean;
  readOnly:boolean;
  options:string[];
  selected:string[];
}

export async function inspectPdfFormFields(bytes:Uint8Array):Promise<PdfFormFieldInfo[]>{
  const pdf=await load(bytes);
  const form=pdf.getForm();
  return form.getFields().map((field)=>{
    const name=field.getName();
    const constructor=field.constructor.name;
    let type='unknown';
    let options:string[]=[];
    let selected:string[]=[];
    if(constructor==='PDFTextField')type='text';
    else if(constructor==='PDFCheckBox')type='checkbox';
    else if(constructor==='PDFRadioGroup'){
      type='radio';
      const radio=form.getRadioGroup(name);
      options=radio.getOptions();
      const value=radio.getSelected();
      if(value)selected=[value];
    }else if(constructor==='PDFDropdown'){
      type='dropdown';
      const dropdown=form.getDropdown(name);
      options=dropdown.getOptions();
      selected=dropdown.getSelected();
    }else if(constructor==='PDFOptionList'){
      type='list';
      const list=form.getOptionList(name);
      options=list.getOptions();
      selected=list.getSelected();
    }else if(constructor==='PDFButton')type='button';
    else if(constructor==='PDFSignature')type='signature';
    return {
      name,
      type,
      required:field.isRequired(),
      readOnly:field.isReadOnly(),
      options,
      selected,
    };
  });
}

export interface PdfAttachmentSpec {
  name:string;
  bytes:Uint8Array;
  mimeType?:string;
  description?:string;
}

export async function attachFileToPdf(bytes:Uint8Array,spec:PdfAttachmentSpec):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const name=spec.name.replace(/[\\/\u0000-\u001F]/g,'_').trim().slice(0,180);
  if(!name)throw new Error('Attachment name is empty.');
  if(!spec.bytes.length)throw new Error('Attachment is empty.');
  if(spec.bytes.length>50*1024*1024)throw new Error('Attachment exceeds the 50 MB per-file safety limit.');
  await pdf.attach(Uint8Array.from(spec.bytes),name,{
    mimeType:(spec.mimeType||'application/octet-stream').slice(0,120),
    description:(spec.description||'Embedded by MALENJO').slice(0,500),
    creationDate:new Date(),
    modificationDate:new Date(),
  });
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}


export type PdfTextAlign='left'|'center'|'right';

function renderedTemplate(template:string,pageNumber:number,pageCount:number):string{
  const date=new Date().toLocaleDateString('en-CA');
  return template
    .replace(/\{page\}/gi,String(pageNumber))
    .replace(/\{pages\}/gi,String(pageCount))
    .replace(/\{date\}/gi,date)
    .replace(/[\u0000-\u001F]/g,' ')
    .trim()
    .slice(0,500);
}

function textX(
  width:number,
  textWidth:number,
  margin:number,
  align:PdfTextAlign,
):number{
  if(align==='center')return Math.max(margin,(width-textWidth)/2);
  if(align==='right')return Math.max(margin,width-margin-textWidth);
  return margin;
}

export interface PdfHeaderFooterSpec {
  pageNumbers?:number[];
  header?:string;
  footer?:string;
  fontSize?:number;
  margin?:number;
  headerAlign?:PdfTextAlign;
  footerAlign?:PdfTextAlign;
}

export async function addPdfHeaderFooter(
  bytes:Uint8Array,
  spec:PdfHeaderFooterSpec,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const pageCount=pdf.getPageCount();
  const indices=spec.pageNumbers?.length
    ? requirePages(spec.pageNumbers,pageCount)
    : pdf.getPageIndices();
  const fontSize=spec.fontSize??9;
  if(!Number.isFinite(fontSize)||fontSize<4||fontSize>72){
    throw new Error('Header/footer font size must be between 4 and 72 points.');
  }
  const margin=spec.margin??24;
  if(!Number.isFinite(margin)||margin<0||margin>180){
    throw new Error('Header/footer margin must be between 0 and 180 points.');
  }
  const headerTemplate=(spec.header??'').trim();
  const footerTemplate=(spec.footer??'').trim();
  if(!headerTemplate&&!footerTemplate)throw new Error('Enter header or footer text.');
  const font=await pdf.embedFont(StandardFonts.Helvetica);

  for(const index of indices){
    const page=pdf.getPage(index);
    const pageNumber=index+1;
    const {width,height}=page.getSize();
    if(headerTemplate){
      const text=renderedTemplate(headerTemplate,pageNumber,pageCount);
      const textWidth=font.widthOfTextAtSize(text,fontSize);
      page.drawText(text,{
        x:textX(width,textWidth,margin,spec.headerAlign??'center'),
        y:Math.max(0,height-margin-fontSize),
        size:fontSize,
        font,
        color:rgb(0.16,0.2,0.24),
      });
    }
    if(footerTemplate){
      const text=renderedTemplate(footerTemplate,pageNumber,pageCount);
      const textWidth=font.widthOfTextAtSize(text,fontSize);
      page.drawText(text,{
        x:textX(width,textWidth,margin,spec.footerAlign??'center'),
        y:Math.max(0,margin),
        size:fontSize,
        font,
        color:rgb(0.16,0.2,0.24),
      });
    }
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export type PdfBatesPosition=
  |'top-left'|'top-center'|'top-right'
  |'bottom-left'|'bottom-center'|'bottom-right';

export interface PdfBatesSpec {
  pageNumbers?:number[];
  prefix?:string;
  suffix?:string;
  startNumber?:number;
  digits?:number;
  fontSize?:number;
  margin?:number;
  position?:PdfBatesPosition;
}

export async function addPdfBatesNumbers(
  bytes:Uint8Array,
  spec:PdfBatesSpec,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const pageCount=pdf.getPageCount();
  const indices=spec.pageNumbers?.length
    ? requirePages(spec.pageNumbers,pageCount)
    : pdf.getPageIndices();
  const start=spec.startNumber??1;
  const digits=spec.digits??6;
  const fontSize=spec.fontSize??9;
  const margin=spec.margin??24;
  if(!Number.isInteger(start)||start<0||start>999_999_999){
    throw new Error('Bates start number must be an integer between 0 and 999,999,999.');
  }
  if(!Number.isInteger(digits)||digits<1||digits>12){
    throw new Error('Bates digit count must be between 1 and 12.');
  }
  if(!Number.isFinite(fontSize)||fontSize<4||fontSize>72){
    throw new Error('Bates font size must be between 4 and 72 points.');
  }
  if(!Number.isFinite(margin)||margin<0||margin>180){
    throw new Error('Bates margin must be between 0 and 180 points.');
  }
  const prefix=(spec.prefix??'').replace(/[\u0000-\u001F]/g,' ').slice(0,80);
  const suffix=(spec.suffix??'').replace(/[\u0000-\u001F]/g,' ').slice(0,80);
  const position=spec.position??'bottom-right';
  const [vertical,horizontal]=position.split('-') as ['top'|'bottom',PdfTextAlign];
  const font=await pdf.embedFont(StandardFonts.Helvetica);

  indices.forEach((index,sequence)=>{
    const page=pdf.getPage(index);
    const {width,height}=page.getSize();
    const serial=String(start+sequence).padStart(digits,'0');
    const text=`${prefix}${serial}${suffix}`;
    const textWidth=font.widthOfTextAtSize(text,fontSize);
    page.drawText(text,{
      x:textX(width,textWidth,margin,horizontal),
      y:vertical==='top' ? Math.max(0,height-margin-fontSize) : Math.max(0,margin),
      size:fontSize,
      font,
      color:rgb(0.12,0.16,0.2),
    });
  });

  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export type PdfPageBoxKind='crop'|'trim'|'bleed'|'art';

export interface PdfPageBoxSpec {
  pageNumbers?:number[];
  box:PdfPageBoxKind;
  top:number;
  right:number;
  bottom:number;
  left:number;
}

export async function setPdfPageBox(
  bytes:Uint8Array,
  spec:PdfPageBoxSpec,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const indices=spec.pageNumbers?.length
    ? requirePages(spec.pageNumbers,pdf.getPageCount())
    : pdf.getPageIndices();
  const margins=[
    ['top',spec.top],['right',spec.right],['bottom',spec.bottom],['left',spec.left],
  ] as const;
  for(const [label,value] of margins){
    if(!Number.isFinite(value)||value<0||value>720){
      throw new Error(`Page-box ${label} margin must be between 0 and 720 points.`);
    }
  }

  for(const index of indices){
    const page=pdf.getPage(index);
    const media=page.getMediaBox();
    const x=media.x+spec.left;
    const y=media.y+spec.bottom;
    const width=media.width-spec.left-spec.right;
    const height=media.height-spec.top-spec.bottom;
    if(width<=1||height<=1)throw new Error('Page-box margins leave no usable page area.');
    switch(spec.box){
      case 'crop': page.setCropBox(x,y,width,height); break;
      case 'trim': page.setTrimBox(x,y,width,height); break;
      case 'bleed': page.setBleedBox(x,y,width,height); break;
      case 'art': page.setArtBox(x,y,width,height); break;
    }
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}


export type PdfPageLabelStyle='decimal'|'roman-upper'|'roman-lower'|'letters-upper'|'letters-lower'|'none';

export interface PdfPageLabelRange {
  startPage:number;
  style:PdfPageLabelStyle;
  prefix?:string;
  startNumber?:number;
}

function pageLabelStyleName(style:PdfPageLabelStyle):string|undefined{
  switch(style){
    case 'decimal': return 'D';
    case 'roman-upper': return 'R';
    case 'roman-lower': return 'r';
    case 'letters-upper': return 'A';
    case 'letters-lower': return 'a';
    case 'none': return undefined;
  }
}

export async function setPdfPageLabels(
  bytes:Uint8Array,
  ranges:PdfPageLabelRange[],
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  if(!ranges.length)throw new Error('Configure at least one page-label range.');
  const normalizedRanges=[...ranges]
    .sort((a,b)=>a.startPage-b.startPage)
    .map((range)=>{
      requirePage(range.startPage,pdf.getPageCount());
      const startNumber=range.startNumber??1;
      if(!Number.isInteger(startNumber)||startNumber<1||startNumber>999_999_999){
        throw new Error('Page-label start number must be an integer between 1 and 999,999,999.');
      }
      const prefix=(range.prefix??'').replace(/[\u0000-\u001F]/g,' ').slice(0,120);
      return {...range,prefix,startNumber};
    });
  const seen=new Set<number>();
  for(const range of normalizedRanges){
    if(seen.has(range.startPage))throw new Error(`Only one page-label range may start on page ${range.startPage}.`);
    seen.add(range.startPage);
  }

  const nums=pdf.context.obj([]) as PDFArray;
  for(const range of normalizedRanges){
    const style=pageLabelStyleName(range.style);
    const dictionary=style
      ? range.prefix
        ? pdf.context.obj({
            S:PDFName.of(style),
            P:PDFHexString.fromText(range.prefix),
            St:PDFNumber.of(range.startNumber),
          })
        : pdf.context.obj({
            S:PDFName.of(style),
            St:PDFNumber.of(range.startNumber),
          })
      : range.prefix
        ? pdf.context.obj({P:PDFHexString.fromText(range.prefix)})
        : pdf.context.obj({});
    nums.push(PDFNumber.of(range.startPage-1));
    nums.push(dictionary);
  }
  const pageLabels=pdf.context.obj({Nums:nums});
  pdf.catalog.set(PDFName.of('PageLabels'),pageLabels);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export async function clearPdfPageLabels(bytes:Uint8Array):Promise<Uint8Array>{
  const pdf=await load(bytes);
  pdf.catalog.delete(PDFName.of('PageLabels'));
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

function linkRectangle(
  page:PDFPage,
  x:number,
  y:number,
  widthFraction:number,
  heightFraction:number,
):[number,number,number,number]{
  const nx=normalized(x,'Link X');
  const ny=normalized(y,'Link Y');
  const nw=normalized(widthFraction,'Link width');
  const nh=normalized(heightFraction,'Link height');
  if(nw<=0||nh<=0||nx+nw>1||ny+nh>1)throw new Error('Link rectangle must remain inside the page.');
  const size=page.getSize();
  const left=nx*size.width;
  const bottom=ny*size.height;
  return [left,bottom,left+nw*size.width,bottom+nh*size.height];
}

function appendAnnotation(
  pdf:PDFDocument,
  page:PDFPage,
  annotation:PDFDict,
):void{
  const annotsKey=PDFName.of('Annots');
  let annots=page.node.lookupMaybe(annotsKey,PDFArray);
  if(!annots){
    annots=pdf.context.obj([]) as PDFArray;
    page.node.set(annotsKey,annots);
  }
  annots.push(pdf.context.register(annotation));
}

function safeLinkUri(value:string):string{
  const uri=value.trim().slice(0,2048);
  if(!uri)throw new Error('Link URL is empty.');
  if(/^mailto:/i.test(uri)){
    if(!/^mailto:[^\s@]+@[^\s@]+(?:\?.*)?$/i.test(uri))throw new Error('Enter a valid mailto link.');
    return uri;
  }
  let parsed:URL;
  try{parsed=new URL(uri);}catch{throw new Error('Enter a valid absolute http/https URL or mailto link.');}
  if(!['http:','https:'].includes(parsed.protocol))throw new Error('PDF external links are limited to http, https or mailto URLs.');
  return parsed.toString();
}

export interface PdfUriLinkSpec {
  pageNumber:number;
  url:string;
  x:number;
  y:number;
  width:number;
  height:number;
  label?:string;
}

export async function addPdfUriLink(bytes:Uint8Array,spec:PdfUriLinkSpec):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const page=pdf.getPage(requirePage(spec.pageNumber,pdf.getPageCount()));
  const rect=linkRectangle(page,spec.x,spec.y,spec.width,spec.height);
  const uri=safeLinkUri(spec.url);
  const action=pdf.context.obj({
    S:PDFName.of('URI'),
    URI:PDFString.of(uri),
  });
  const annotation=pdf.context.obj({
    Type:PDFName.of('Annot'),
    Subtype:PDFName.of('Link'),
    Rect:rect,
    Border:[0,0,0],
    A:action,
  }) as PDFDict;
  appendAnnotation(pdf,page,annotation);
  const label=(spec.label??'').replace(/[\u0000-\u001F]/g,' ').trim().slice(0,500);
  if(label){
    const font=await pdf.embedFont(StandardFonts.Helvetica);
    const {width}=page.getSize();
    page.drawText(label,{
      x:rect[0],
      y:rect[1]+Math.max(1,(rect[3]-rect[1]-10)/2),
      size:10,
      font,
      color:rgb(0.04,0.32,0.76),
      maxWidth:Math.max(10,Math.min(rect[2]-rect[0],width-rect[0])),
    });
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export interface PdfInternalLinkSpec {
  pageNumber:number;
  targetPageNumber:number;
  x:number;
  y:number;
  width:number;
  height:number;
}

export async function addPdfInternalPageLink(bytes:Uint8Array,spec:PdfInternalLinkSpec):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const source=pdf.getPage(requirePage(spec.pageNumber,pdf.getPageCount()));
  const target=pdf.getPage(requirePage(spec.targetPageNumber,pdf.getPageCount()));
  const rect=linkRectangle(source,spec.x,spec.y,spec.width,spec.height);
  const annotation=pdf.context.obj({
    Type:PDFName.of('Annot'),
    Subtype:PDFName.of('Link'),
    Rect:rect,
    Border:[0,0,0],
    Dest:[target.ref,PDFName.of('Fit')],
  }) as PDFDict;
  appendAnnotation(pdf,source,annotation);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

export interface PdfDocumentProperties {
  title:string;
  author:string;
  subject:string;
  keywords:string[];
  creator:string;
  producer:string;
  language:string;
  creationDate:string;
  modificationDate:string;
}

function safeProperty(value:string,max=1000):string{
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,' ').trim().slice(0,max);
}

export async function inspectPdfDocumentProperties(bytes:Uint8Array):Promise<PdfDocumentProperties>{
  const pdf=await load(bytes);
  const language=pdf.catalog.get(PDFName.of('Lang'));
  const langText=language instanceof PDFString||language instanceof PDFHexString
    ? language.decodeText()
    : '';
  return {
    title:pdf.getTitle()??'',
    author:pdf.getAuthor()??'',
    subject:pdf.getSubject()??'',
    keywords:(pdf.getKeywords()??'').split(/[\s,;]+/).map((value)=>value.trim()).filter(Boolean),
    creator:pdf.getCreator()??'',
    producer:pdf.getProducer()??'',
    language:langText,
    creationDate:pdf.getCreationDate()?.toISOString()??'',
    modificationDate:pdf.getModificationDate()?.toISOString()??'',
  };
}

export async function setPdfDocumentProperties(
  bytes:Uint8Array,
  properties:Partial<Pick<PdfDocumentProperties,'title'|'author'|'subject'|'keywords'|'creator'|'producer'|'language'>>,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  if(properties.title!==undefined)pdf.setTitle(safeProperty(properties.title),{showInWindowTitleBar:true});
  if(properties.author!==undefined)pdf.setAuthor(safeProperty(properties.author));
  if(properties.subject!==undefined)pdf.setSubject(safeProperty(properties.subject));
  if(properties.keywords!==undefined)pdf.setKeywords(properties.keywords.map((value)=>safeProperty(value,120)).filter(Boolean).slice(0,50));
  if(properties.creator!==undefined)pdf.setCreator(safeProperty(properties.creator));
  if(properties.producer!==undefined)pdf.setProducer(safeProperty(properties.producer));
  if(properties.language!==undefined)pdf.setLanguage(safeProperty(properties.language,64));
  pdf.setModificationDate(new Date());
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
