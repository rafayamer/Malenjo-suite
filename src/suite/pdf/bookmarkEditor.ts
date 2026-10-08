import {
  PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString,
} from 'pdf-lib';

const OUTLINES = PDFName.of('Outlines');
const FIRST = PDFName.of('First');
const LAST = PDFName.of('Last');
const NEXT = PDFName.of('Next');
const PREV = PDFName.of('Prev');
const PARENT = PDFName.of('Parent');
const TITLE = PDFName.of('Title');
const COUNT = PDFName.of('Count');
const MAX_BOOKMARKS = 1000;
const MAX_TITLE = 200;

export interface PdfTopLevelBookmark {
  ref: string;
  title: string;
  editable: boolean;
}

function safeTitle(value: string): string {
  if (typeof value !== 'string' || value.length > MAX_TITLE ||
    !value.trim() || /[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error('Bookmark title must be nonempty, at most 200 characters and contain no control characters.');
  }
  return value;
}
async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!bytes.byteLength) throw new Error('PDF is empty.');
  return PDFDocument.load(bytes, {ignoreEncryption:false,updateMetadata:false});
}
async function save(pdf: PDFDocument): Promise<Uint8Array> {
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

interface OutlineRoot { root:PDFDict; ref:PDFRef }
function existingRoot(pdf:PDFDocument):OutlineRoot|null{
  const ref=pdf.catalog.get(OUTLINES);
  if(!ref)return null;
  if(!(ref instanceof PDFRef)) {
    throw new Error('This imported PDF uses an unsupported direct outline root; bookmarks were not changed.');
  }
  return {ref,root:pdf.context.lookup(ref,PDFDict)};
}

function outlineNodes(pdf:PDFDocument, root:PDFDict):Array<{ref:PDFRef;dict:PDFDict}>{
  const first=root.get(FIRST);
  const last=root.get(LAST);
  if(!first&&!last)return [];
  if(!(first instanceof PDFRef)||!(last instanceof PDFRef)){
    throw new Error('This imported PDF has an invalid outline chain; bookmarks were not changed.');
  }
  const list:Array<{ref:PDFRef;dict:PDFDict}>=[];
  let cursor:PDFRef|undefined=first;
  const visited=new Set<string>();
  while(cursor){
    if(visited.has(cursor.toString())||list.length>=MAX_BOOKMARKS){
      throw new Error('PDF bookmark chain is cyclic or exceeds the 1,000-bookmark safety limit.');
    }
    visited.add(cursor.toString());
    const dict=pdf.context.lookup(cursor,PDFDict);
    list.push({ref:cursor,dict});
    const next=dict.get(NEXT);
    if(next!==undefined && !(next instanceof PDFRef)) {
      throw new Error('PDF outline Next entry is invalid.');
    }
    cursor=next as PDFRef|undefined;
  }
  if(list[list.length-1].ref.toString()!==last.toString()){
    throw new Error('PDF outline Last reference does not match the linked chain.');
  }
  return list;
}

function rootCount(root:PDFDict, entries:number):number{
  const count=root.lookupMaybe(COUNT,PDFNumber)?.asNumber();
  if(count===undefined && entries===0)return 0;
  if(count===undefined||!Number.isSafeInteger(count)||count<0||count<entries){
    throw new Error('Imported PDF outline count is inconsistent; bookmarks were not changed.');
  }
  return count!;
}
function displayTitle(dict:PDFDict):string{
  const title=dict.get(TITLE);
  return title instanceof PDFString||title instanceof PDFHexString?title.decodeText():'(unreadable title)';
}

/** All top-level entries are listed; only leaf bookmarks can be safely edited/deleted. */
export async function listPdfTopLevelBookmarks(bytes:Uint8Array):Promise<PdfTopLevelBookmark[]>{
  const pdf=await load(bytes);
  const outline=existingRoot(pdf);
  if(!outline)return [];
  const nodes=outlineNodes(pdf,outline.root);
  return nodes.map(({ref,dict})=>({
    ref:ref.toString(),
    title:displayTitle(dict),
    editable:!dict.has(FIRST)&&!dict.has(LAST),
  }));
}

/** Append a real top-level /Outlines leaf targeting an existing page using /Fit. */
export async function addPdfTopLevelBookmark(
  bytes:Uint8Array, title:string, pageNumber:number,
):Promise<Uint8Array>{
  safeTitle(title);
  const pdf=await load(bytes);
  if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>pdf.getPageCount()){
    throw new Error('Bookmark destination page is outside this PDF.');
  }
  let outline=existingRoot(pdf);
  if(!outline){
    const root=pdf.context.obj({Type:PDFName.of('Outlines'),Count:0});
    const ref=pdf.context.register(root);
    pdf.catalog.set(OUTLINES,ref);
    outline={root,ref};
  }
  const existing=outlineNodes(pdf,outline.root);
  if(existing.length>=MAX_BOOKMARKS)throw new Error('This PDF already has 1,000 top-level bookmarks.');
  const count=rootCount(outline.root,existing.length);
  const page=pdf.getPage(pageNumber-1);
  const node=pdf.context.obj({
    Title:PDFHexString.fromText(title),
    Parent:outline.ref,
    Dest:pdf.context.obj([page.ref,PDFName.of('Fit')]),
  });
  const bookmarkRef=pdf.context.register(node);
  if(existing.length){
    const previous=existing[existing.length-1];
    if(previous.dict.has(NEXT))throw new Error('Outline tail unexpectedly has a Next pointer.');
    previous.dict.set(NEXT,bookmarkRef);
    node.set(PREV,previous.ref);
  }else{
    outline.root.set(FIRST,bookmarkRef);
  }
  outline.root.set(LAST,bookmarkRef);
  outline.root.set(COUNT,PDFNumber.of(count+1));
  return save(pdf);
}

function findLeaf(
  pdf:PDFDocument, target:string,
):{root:PDFDict;nodes:Array<{ref:PDFRef;dict:PDFDict}>;index:number}{
  const outline=existingRoot(pdf);
  if(!outline)throw new Error('This PDF has no bookmarks.');
  const nodes=outlineNodes(pdf,outline.root);
  rootCount(outline.root,nodes.length);
  const index=nodes.findIndex(item=>item.ref.toString()===target);
  if(index<0)throw new Error('Selected bookmark no longer exists; refresh the bookmark list.');
  if(nodes[index].dict.has(FIRST)||nodes[index].dict.has(LAST)){
    throw new Error('Nested bookmarks cannot be edited or removed by this tool.');
  }
  return {root:outline.root,nodes,index};
}

export async function renamePdfTopLevelBookmark(
  bytes:Uint8Array, targetRef:string, title:string,
):Promise<Uint8Array>{
  safeTitle(title);
  const pdf=await load(bytes);
  const found=findLeaf(pdf,targetRef);
  found.nodes[found.index].dict.set(TITLE,PDFHexString.fromText(title));
  return save(pdf);
}

export async function deletePdfTopLevelBookmark(
  bytes:Uint8Array, targetRef:string,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const {root,nodes,index}=findLeaf(pdf,targetRef);
  const count=rootCount(root,nodes.length);
  const previous=nodes[index-1];
  const next=nodes[index+1];
  if(previous) {
    if(next) previous.dict.set(NEXT,next.ref);
    else previous.dict.delete(NEXT);
  }else if(next)root.set(FIRST,next.ref);
  else root.delete(FIRST);
  if(next){
    if(previous)next.dict.set(PREV,previous.ref);
    else next.dict.delete(PREV);
  }else if(previous)root.set(LAST,previous.ref);
  else root.delete(LAST);
  root.set(COUNT,PDFNumber.of(count-1));
  // Keep unreferenced former node in context: safe for incremental PDF history.
  return save(pdf);
}
