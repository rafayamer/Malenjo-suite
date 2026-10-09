import {describe,expect,it} from 'vitest';
import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFNumber,PDFRef} from 'pdf-lib';
import {
  addPdfOutlineTreeEntry,listPdfOutlineTree,renamePdfOutlineTreeEntry,
  movePdfOutlineTreeEntry,deletePdfOutlineTreeEntry,
  PDF_OUTLINE_MAX_INPUT_BYTES,
} from './pdfOutlineTree';

async function blank(pageCount=4):Promise<Uint8Array>{
  const doc=await PDFDocument.create();
  for(let i=0;i<pageCount;i++)doc.addPage([400+i,600+i]);
  return Uint8Array.from(await doc.save({useObjectStreams:false}));
}
describe('hierarchical PDF table-of-contents editor',()=>{
  it('creates nested Unicode destination bookmarks and reopens a valid linked hierarchy',async()=>{
    const original=await blank(),snapshot=Uint8Array.from(original);
    let bytes=await addPdfOutlineTreeEntry(original,'Part One',1);
    let entries=await listPdfOutlineTree(bytes);
    expect(entries).toMatchObject([{title:'Part One',depth:0,pageNumber:1,hasChildren:false}]);
    bytes=await addPdfOutlineTreeEntry(bytes,'Chapter & étude',2,entries[0].ref);
    entries=await listPdfOutlineTree(bytes);
    bytes=await addPdfOutlineTreeEntry(bytes,'Deepest',3,entries[1].ref);
    bytes=await addPdfOutlineTreeEntry(bytes,'Part Two',4);
    const result=await listPdfOutlineTree(bytes);
    expect(result.map(x=>[x.title,x.depth,x.pageNumber])).toEqual([
      ['Part One',0,1],['Chapter & étude',1,2],['Deepest',2,3],['Part Two',0,4],
    ]);
    expect(result[0].hasChildren).toBe(true);
    expect(result[1].hasChildren).toBe(true);
    expect(result[2].parentRef).toBe(result[1].ref);
    const parsed=await PDFDocument.load(bytes);
    const root=parsed.catalog.lookup(PDFName.of('Outlines'),PDFDict);
    expect(root.lookup(PDFName.of('Count'),PDFNumber).asNumber()).toBe(4);
    const parent=parsed.context.lookup(root.get(PDFName.of('First')) as PDFRef,PDFDict);
    expect(parent.lookup(PDFName.of('Count'),PDFNumber).asNumber()).toBe(2);
    expect(original).toEqual(snapshot);
    expect((await PDFDocument.load(original)).getPageCount()).toBe(4);
  });
  it('renames nested entries and moves entire branches without changing PDF page targets',async()=>{
    let bytes=await addPdfOutlineTreeEntry(await blank(),'Part A',1);
    bytes=await addPdfOutlineTreeEntry(bytes,'Part B',3);
    let entries=await listPdfOutlineTree(bytes);
    bytes=await addPdfOutlineTreeEntry(bytes,'One',1,entries[0].ref);
    bytes=await addPdfOutlineTreeEntry(bytes,'Two',2,entries[0].ref);
    entries=await listPdfOutlineTree(bytes);
    bytes=await movePdfOutlineTreeEntry(bytes,entries.find(x=>x.title==='Two')!.ref,-1);
    entries=await listPdfOutlineTree(bytes);
    expect(entries.map(x=>x.title)).toEqual(['Part A','Two','One','Part B']);
    bytes=await renamePdfOutlineTreeEntry(bytes,entries[1].ref,'Renamed Deux');
    entries=await listPdfOutlineTree(bytes);
    expect(entries[1]).toMatchObject({title:'Renamed Deux',depth:1,pageNumber:2});
    bytes=await movePdfOutlineTreeEntry(bytes,entries[0].ref,1);
    entries=await listPdfOutlineTree(bytes);
    expect(entries.map(x=>x.title)).toEqual(['Part B','Part A','Renamed Deux','One']);
    expect(entries[2].pageNumber).toBe(2);
    await expect(movePdfOutlineTreeEntry(bytes,entries[0].ref,-1))
      .rejects.toThrow(/already at the end/i);
  });
  it('requires explicit subtree deletion, preserving neighboring siblings',async()=>{
    let bytes=await addPdfOutlineTreeEntry(await blank(),'Parent',1);
    bytes=await addPdfOutlineTreeEntry(bytes,'Neighbor',2);
    let entries=await listPdfOutlineTree(bytes);
    bytes=await addPdfOutlineTreeEntry(bytes,'Child',3,entries[0].ref);
    entries=await listPdfOutlineTree(bytes);
    await expect(deletePdfOutlineTreeEntry(bytes,entries[0].ref))
      .rejects.toThrow(/explicit subtree deletion/);
    bytes=await deletePdfOutlineTreeEntry(bytes,entries[0].ref,true);
    expect((await listPdfOutlineTree(bytes)).map(x=>x.title)).toEqual(['Neighbor']);
    bytes=await deletePdfOutlineTreeEntry(bytes,(await listPdfOutlineTree(bytes))[0].ref);
    expect(await listPdfOutlineTree(bytes)).toEqual([]);
    const pdf=await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.catalog.lookup(PDFName.of('Outlines'),PDFDict)
      .lookup(PDFName.of('Count'),PDFNumber).asNumber()).toBe(0);
  });
  it('preserves preexisting named destinations and closed subtrees through sibling edits',async()=>{
    const pdf=await PDFDocument.load(await blank());
    const root=pdf.context.obj({Type:PDFName.of('Outlines'),Count:1});
    const rootRef=pdf.context.register(root);
    const parent=pdf.context.obj({
      Title:PDFHexString.fromText('Closed group'),Parent:rootRef,Count:-1,
    });
    const parentRef=pdf.context.register(parent);
    const child=pdf.context.obj({
      Title:PDFHexString.fromText('Named target'),Parent:parentRef,
      Dest:PDFName.of('named-existing-dest'),
    });
    const childRef=pdf.context.register(child);
    parent.set(PDFName.of('First'),childRef);
    parent.set(PDFName.of('Last'),childRef);
    root.set(PDFName.of('First'),parentRef);
    root.set(PDFName.of('Last'),parentRef);
    pdf.catalog.set(PDFName.of('Outlines'),rootRef);
    let bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await listPdfOutlineTree(bytes)).toMatchObject([
      {title:'Closed group',depth:0,expanded:false},
      {title:'Named target',depth:1,pageNumber:null},
    ]);
    bytes=await addPdfOutlineTreeEntry(bytes,'Independent group',4);
    const reloaded=await PDFDocument.load(bytes);
    const first=reloaded.context.lookup(
      reloaded.catalog.lookup(PDFName.of('Outlines'),PDFDict).get(PDFName.of('First')) as PDFRef,
      PDFDict);
    expect(first.lookup(PDFName.of('Count'),PDFNumber).asNumber()).toBe(-1);
    expect(reloaded.catalog.lookup(PDFName.of('Outlines'),PDFDict)
      .lookup(PDFName.of('Count'),PDFNumber).asNumber()).toBe(2);
    const oldChild=reloaded.context.lookup(first.get(PDFName.of('First')) as PDFRef,PDFDict);
    expect(oldChild.get(PDFName.of('Dest'))?.toString()).toBe('/named-existing-dest');
  });
  it('refuses cycles and inconsistent imported sibling backlinks rather than corrupting files',async()=>{
    let bytes=await addPdfOutlineTreeEntry(await blank(),'First',1);
    bytes=await addPdfOutlineTreeEntry(bytes,'Second',2);
    const pdf=await PDFDocument.load(bytes);
    const root=pdf.catalog.lookup(PDFName.of('Outlines'),PDFDict);
    const first=root.get(PDFName.of('First')) as PDFRef;
    const node=pdf.context.lookup(first,PDFDict);
    node.set(PDFName.of('Next'),first);
    await expect(listPdfOutlineTree(Uint8Array.from(await pdf.save())))
      .rejects.toThrow(/cyclic/);
  });
  it('refuses certified and hybrid/XFA PDFs on mutation, without prohibiting read-only inspection',async()=>{
    const certified=await PDFDocument.load(await blank());
    certified.catalog.set(PDFName.of('Perms'),certified.context.obj({DocMDP:certified.context.obj({})}));
    const bytes=Uint8Array.from(await certified.save());
    expect(await listPdfOutlineTree(bytes)).toEqual([]);
    await expect(addPdfOutlineTreeEntry(bytes,'Unsafe',1)).rejects.toThrow(/Certified PDFs/);
    const xfa=await PDFDocument.load(await blank());
    const form=xfa.context.obj({Fields:[],XFA:'fake'});
    xfa.catalog.set(PDFName.of('AcroForm'),xfa.context.register(form));
    await expect(addPdfOutlineTreeEntry(Uint8Array.from(await xfa.save()),'Unsafe',1))
      .rejects.toThrow(/Hybrid\/XFA/);
  });
  it('rejects missing targets, oversized files, bad titles and invalid page destinations',async()=>{
    const bytes=await blank();
    expect(PDF_OUTLINE_MAX_INPUT_BYTES).toBe(32*1024*1024);
    await expect(addPdfOutlineTreeEntry(bytes,'',1)).rejects.toThrow(/title/);
    await expect(addPdfOutlineTreeEntry(bytes,'Good',0)).rejects.toThrow(/out of range/);
    await expect(addPdfOutlineTreeEntry(bytes,'Good',7)).rejects.toThrow(/out of range/);
    await expect(addPdfOutlineTreeEntry(bytes,'Child',1,'999 0 R')).rejects.toThrow(/no longer exists/);
    await expect(renamePdfOutlineTreeEntry(bytes,'999 0 R','Safe')).rejects.toThrow(/no longer exists/);
    await expect(deletePdfOutlineTreeEntry(bytes,'999 0 R')).rejects.toThrow(/no longer exists/);
    await expect(listPdfOutlineTree(new Uint8Array(PDF_OUTLINE_MAX_INPUT_BYTES+1)))
      .rejects.toThrow(/32 MB/);
  });
});
