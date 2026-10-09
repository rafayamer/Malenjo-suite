import {
  PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFNumber,
  PDFRef,PDFSignature,PDFString,
} from 'pdf-lib';

/**
 * Offline edit of a bounded PDF /Outlines hierarchy. Preserves existing
 * named destinations, actions, and unrelated outline properties. Newly added
 * entries use a direct /Fit page reference. Mutations refuse signed, XFA,
 * encrypted and certified documents; the caller must commit through Undo.
 */
export const PDF_OUTLINE_MAX_INPUT_BYTES=32*1024*1024;
export const PDF_OUTLINE_MAX_ENTRIES=1000;
export const PDF_OUTLINE_MAX_DEPTH=16;
const N=(value:string)=>PDFName.of(value);
const ROOT=N('Outlines'),FIRST=N('First'),LAST=N('Last'),PREV=N('Prev'),
  NEXT=N('Next'),PARENT=N('Parent'),COUNT=N('Count'),TITLE=N('Title');
type Node={ref:PDFRef;dict:PDFDict;children:Node[];expanded:boolean};
type Outline={pdf:PDFDocument;root:PDFDict|null;rootRef:PDFRef|null;nodes:Node[]};
export interface PdfOutlineTreeEntry{
  ref:string;title:string;depth:number;parentRef:string|null;
  pageNumber:number|null;hasChildren:boolean;expanded:boolean;
}
function titleText(dict:PDFDict):string{
  const obj=dict.get(TITLE);
  if(!(obj instanceof PDFString||obj instanceof PDFHexString)){
    throw new Error('Imported PDF bookmark is missing a readable title.');
  }
  const title=obj.decodeText();
  if(!title.trim()||title.length>300){
    throw new Error('Imported PDF bookmark contains an invalid title.');
  }
  return title;
}
function safeNewTitle(title:string):void{
  if(typeof title!=='string'||!title.trim()||title.length>200||
     /[\u0000-\u001f\u007f-\u009f]/.test(title)){
    throw new Error('Bookmark title must contain 1–200 printable characters.');
  }
}
function parseChildren(
  pdf:PDFDocument,parent:PDFDict,parentRef:PDFRef,seen:Set<string>,depth:number,
):Node[]{
  const first=parent.get(FIRST),last=parent.get(LAST);
  if(first===undefined&&last===undefined)return [];
  if(!(first instanceof PDFRef)||!(last instanceof PDFRef)){
    throw new Error('PDF outline /First and /Last links are inconsistent.');
  }
  if(depth>PDF_OUTLINE_MAX_DEPTH){
    throw new Error('PDF bookmarks exceed 16 hierarchy levels.');
  }
  const nodes:Node[]=[];
  let ref:PDFRef|undefined=first;
  let previous:PDFRef|undefined;
  while(ref){
    const id=ref.toString();
    if(seen.has(id)||seen.size>=PDF_OUTLINE_MAX_ENTRIES){
      throw new Error('PDF outline has cyclic links or exceeds 1,000 entries.');
    }
    seen.add(id);
    const dict=pdf.context.lookup(ref,PDFDict);
    titleText(dict);
    const parentEntry=dict.get(PARENT);
    if(!(parentEntry instanceof PDFRef)||parentEntry.toString()!==parentRef.toString()){
      throw new Error('PDF bookmark parent pointer is inconsistent.');
    }
    const prior=dict.get(PREV);
    if(prior!==undefined&&!(prior instanceof PDFRef)){
      throw new Error('PDF bookmark previous pointer is invalid.');
    }
    if((prior as PDFRef|undefined)?.toString()!==previous?.toString()){
      throw new Error('PDF bookmark sibling backlink is inconsistent.');
    }
    const next=dict.get(NEXT);
    if(next!==undefined&&!(next instanceof PDFRef)){
      throw new Error('PDF bookmark next pointer is invalid.');
    }
    const children=parseChildren(pdf,dict,ref,seen,depth+1);
    const count=dict.lookupMaybe(COUNT,PDFNumber)?.asNumber();
    if(count!==undefined&&(!Number.isSafeInteger(count)||Math.abs(count)>PDF_OUTLINE_MAX_ENTRIES)){
      throw new Error('PDF bookmark descendant count is invalid.');
    }
    nodes.push({ref,dict,children,expanded:count===undefined||count>=0});
    previous=ref;
    ref=next as PDFRef|undefined;
  }
  if(previous?.toString()!==last.toString()){
    throw new Error('PDF outline last pointer is inconsistent.');
  }
  return nodes;
}
async function openOutline(bytes:Uint8Array,mutate:boolean):Promise<Outline>{
  if(!(bytes instanceof Uint8Array)||bytes.length<5||
     bytes.length>PDF_OUTLINE_MAX_INPUT_BYTES){
    throw new Error('PDF outline editor supports files up to 32 MB.');
  }
  const pdf=await PDFDocument.load(bytes,{
    ignoreEncryption:false,updateMetadata:false,
  });
  if(pdf.getPageCount()<1||pdf.getPageCount()>2000){
    throw new Error('PDF outline editor supports 1–2,000 pages.');
  }
  if(mutate){
    if(pdf.catalog.has(N('Perms'))){
      throw new Error('Certified PDFs cannot be safely rewritten by the outline editor.');
    }
    const acro=pdf.catalog.lookupMaybe(N('AcroForm'),PDFDict);
    if(acro?.has(N('XFA'))){
      throw new Error('Hybrid/XFA PDFs cannot be safely rewritten by the outline editor.');
    }
    if(acro?.get(N('Fields'))!==undefined&&
       pdf.getForm().getFields().some(field=>field instanceof PDFSignature||
         field.acroField.dict.get(N('FT'))?.toString()==='/Sig')){
      throw new Error('PDF contains signature fields; outline mutations are unsafe.');
    }
    // A non-form signature can also occur directly in a PDF dictionary.
    for(const [,item] of pdf.context.enumerateIndirectObjects()){
      if(item instanceof PDFDict&&item.has(N('ByteRange'))){
        throw new Error('PDF contains a digital signature byte range; outline mutations are unsafe.');
      }
    }
  }
  const rootPointer=pdf.catalog.get(ROOT);
  if(rootPointer===undefined)return {pdf,root:null,rootRef:null,nodes:[]};
  if(!(rootPointer instanceof PDFRef)){
    throw new Error('Imported PDF has an unsupported direct outline root.');
  }
  const root=pdf.context.lookup(rootPointer,PDFDict);
  const nodes=parseChildren(pdf,root,rootPointer,new Set(),0);
  return {pdf,root,rootRef:rootPointer,nodes};
}
function walk(nodes:Node[],callback:(node:Node,depth:number,parentRef:string|null)=>void,
  depth=0,parentRef:string|null=null):void{
  for(const node of nodes){
    callback(node,depth,parentRef);
    walk(node.children,callback,depth+1,node.ref.toString());
  }
}
function find(nodes:Node[],ref:string):Node|undefined{
  let output:Node|undefined;
  walk(nodes,node=>{if(node.ref.toString()===ref)output=node;});
  return output;
}
function siblings(nodes:Node[],ref:string):{items:Node[];index:number}|null{
  for(const node of nodes){
    if(node.ref.toString()===ref)return {items:nodes,index:nodes.indexOf(node)};
    const nested=siblings(node.children,ref);
    if(nested)return nested;
  }
  return null;
}
function visible(nodes:Node[]):number{
  return nodes.reduce((result,node)=>result+1+(node.expanded?visible(node.children):0),0);
}
function rewrite(pdf:PDFDocument,dict:PDFDict,ref:PDFRef,nodes:Node[]):void{
  if(nodes.length){
    dict.set(FIRST,nodes[0].ref);
    dict.set(LAST,nodes[nodes.length-1].ref);
  }else{
    dict.delete(FIRST);
    dict.delete(LAST);
  }
  for(let i=0;i<nodes.length;i++){
    const node=nodes[i];
    node.dict.set(PARENT,ref);
    if(i)node.dict.set(PREV,nodes[i-1].ref);else node.dict.delete(PREV);
    if(i+1<nodes.length)node.dict.set(NEXT,nodes[i+1].ref);else node.dict.delete(NEXT);
    rewrite(pdf,node.dict,node.ref,node.children);
    if(node.children.length){
      const number=visible(node.children);
      node.dict.set(COUNT,PDFNumber.of(node.expanded?number:-number));
    }else node.dict.delete(COUNT);
  }
}
async function saveOutline(value:Outline):Promise<Uint8Array>{
  if(!value.root||!value.rootRef)throw new Error('Missing PDF outline root.');
  rewrite(value.pdf,value.root,value.rootRef,value.nodes);
  value.root.set(COUNT,PDFNumber.of(visible(value.nodes)));
  const output=Uint8Array.from(await value.pdf.save({useObjectStreams:false,updateFieldAppearances:false}));
  if(output.length>PDF_OUTLINE_MAX_INPUT_BYTES){
    throw new Error('Modified PDF outline exceeds the 32 MB output budget.');
  }
  const reopened=await openOutline(output,false);
  if(!reopened.root||visible(reopened.nodes)!==visible(value.nodes)){
    throw new Error('Modified PDF outline cannot be reopened consistently.');
  }
  return output;
}
/** Enumerate true PDF bookmark hierarchy, not just the top-level toolbar. */
export async function listPdfOutlineTree(bytes:Uint8Array):Promise<PdfOutlineTreeEntry[]>{
  const source=await openOutline(bytes,false);
  const pages=new Map(source.pdf.getPages().map((page,index)=>[page.ref.toString(),index+1]));
  const output:PdfOutlineTreeEntry[]=[];
  walk(source.nodes,(node,depth,parentRef)=>{
    const dest=node.dict.lookupMaybe(N('Dest'),PDFArray);
    const target=dest?.get(0);
    output.push({
      ref:node.ref.toString(),title:titleText(node.dict),depth,parentRef,
      pageNumber:target instanceof PDFRef?pages.get(target.toString())??null:null,
      hasChildren:node.children.length>0,expanded:node.expanded,
    });
  });
  return output;
}
export async function addPdfOutlineTreeEntry(
  bytes:Uint8Array,title:string,pageNumber:number,parentRef:string|null=null,
):Promise<Uint8Array>{
  safeNewTitle(title);
  const outline=await openOutline(bytes,true);
  if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>outline.pdf.getPageCount()){
    throw new Error('Bookmark page is out of range.');
  }
  if(!outline.root){
    const root=outline.pdf.context.obj({Type:ROOT,Count:0});
    outline.rootRef=outline.pdf.context.register(root);
    outline.pdf.catalog.set(ROOT,outline.rootRef);
    outline.root=root;
  }
  let target=outline.nodes;
  if(parentRef){
    const parent=find(outline.nodes,parentRef);
    if(!parent)throw new Error('Selected bookmark parent no longer exists.');
    const depth=(():number=>{
      let n=0;
      walk(outline.nodes,(node,d)=>{if(node.ref.toString()===parentRef)n=d;});
      return n;
    })();
    if(depth+1>PDF_OUTLINE_MAX_DEPTH)throw new Error('PDF bookmark nesting exceeds 16 levels.');
    target=parent.children;
    parent.expanded=true;
  }
  let count=0;walk(outline.nodes,()=>count++);
  if(count>=PDF_OUTLINE_MAX_ENTRIES)throw new Error('PDF already has 1,000 bookmarks.');
  const page=outline.pdf.getPage(pageNumber-1);
  const dict=outline.pdf.context.obj({
    Title:PDFHexString.fromText(title),
    Parent:outline.rootRef!,
    Dest:outline.pdf.context.obj([page.ref,N('Fit')]),
  });
  const ref=outline.pdf.context.register(dict);
  target.push({ref,dict,children:[],expanded:true});
  return saveOutline(outline);
}
export async function renamePdfOutlineTreeEntry(
  bytes:Uint8Array,targetRef:string,title:string,
):Promise<Uint8Array>{
  safeNewTitle(title);
  const source=await openOutline(bytes,true);
  const selected=find(source.nodes,targetRef);
  if(!selected)throw new Error('Selected bookmark no longer exists.');
  selected.dict.set(TITLE,PDFHexString.fromText(title));
  return saveOutline(source);
}
export async function movePdfOutlineTreeEntry(
  bytes:Uint8Array,targetRef:string,direction:-1|1,
):Promise<Uint8Array>{
  if(direction!==-1&&direction!==1)throw new Error('Choose one bookmark step up or down.');
  const source=await openOutline(bytes,true);
  const match=siblings(source.nodes,targetRef);
  if(!match)throw new Error('Selected bookmark no longer exists.');
  const other=match.index+direction;
  if(other<0||other>=match.items.length){
    throw new Error('Bookmark is already at the end of its sibling list.');
  }
  [match.items[match.index],match.items[other]]=[match.items[other],match.items[match.index]];
  return saveOutline(source);
}
export async function deletePdfOutlineTreeEntry(
  bytes:Uint8Array,targetRef:string,includeChildren=false,
):Promise<Uint8Array>{
  const source=await openOutline(bytes,true);
  const match=siblings(source.nodes,targetRef);
  if(!match)throw new Error('Selected bookmark no longer exists.');
  const selected=match.items[match.index];
  if(selected.children.length&&!includeChildren){
    throw new Error('This bookmark has children; explicit subtree deletion is required.');
  }
  match.items.splice(match.index,1);
  return saveOutline(source);
}
