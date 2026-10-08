import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import {
  addPdfTopLevelBookmark, deletePdfTopLevelBookmark,
  listPdfTopLevelBookmarks, renamePdfTopLevelBookmark,
} from './bookmarkEditor';

async function sample(pages=3):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  for(let i=0;i<pages;i++)pdf.addPage([400+i,600+i]);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

describe('top-level PDF bookmark editing',()=>{
  it('creates Unicode bookmarks with a real page reference and valid root links',async()=>{
    let bytes=await addPdfTopLevelBookmark(await sample(3),'Introduction',1);
    bytes=await addPdfTopLevelBookmark(bytes,'Résumé – final',3);
    const list=await listPdfTopLevelBookmarks(bytes);
    expect(list.map(e=>e.title)).toEqual(['Introduction','Résumé – final']);
    expect(list.every(e=>e.editable)).toBe(true);

    const pdf=await PDFDocument.load(bytes);
    const root=pdf.catalog.lookup(PDFName.of('Outlines'),PDFDict);
    const first=root.get(PDFName.of('First')) as PDFRef;
    const last=root.get(PDFName.of('Last')) as PDFRef;
    expect(first).toBeInstanceOf(PDFRef);
    expect(last).toBeInstanceOf(PDFRef);
    expect(root.lookup(PDFName.of('Count'),PDFNumber).asNumber()).toBe(2);
    const firstNode=pdf.context.lookup(first,PDFDict);
    const lastNode=pdf.context.lookup(last,PDFDict);
    expect(firstNode.get(PDFName.of('Next'))?.toString()).toBe(last.toString());
    expect(lastNode.get(PDFName.of('Prev'))?.toString()).toBe(first.toString());
    expect(lastNode.get(PDFName.of('Title'))).toBeInstanceOf(PDFHexString);
  });

  it('renames and deletes first, middle and last leaves while preserving neighbors',async()=>{
    let bytes=await sample();
    for(const name of ['First','Middle','Last'])bytes=await addPdfTopLevelBookmark(bytes,name,1);
    let list=await listPdfTopLevelBookmarks(bytes);
    bytes=await renamePdfTopLevelBookmark(bytes,list[1].ref,'Changed middle');
    expect((await listPdfTopLevelBookmarks(bytes)).map(x=>x.title)).toEqual(['First','Changed middle','Last']);

    list=await listPdfTopLevelBookmarks(bytes);
    bytes=await deletePdfTopLevelBookmark(bytes,list[1].ref);
    list=await listPdfTopLevelBookmarks(bytes);
    expect(list.map(x=>x.title)).toEqual(['First','Last']);
    bytes=await deletePdfTopLevelBookmark(bytes,list[0].ref);
    list=await listPdfTopLevelBookmarks(bytes);
    expect(list.map(x=>x.title)).toEqual(['Last']);
    bytes=await deletePdfTopLevelBookmark(bytes,list[0].ref);
    expect(await listPdfTopLevelBookmarks(bytes)).toEqual([]);
    const root=(await PDFDocument.load(bytes)).catalog.lookup(PDFName.of('Outlines'),PDFDict);
    expect(root.lookup(PDFName.of('Count'),PDFNumber).asNumber()).toBe(0);
    expect(root.has(PDFName.of('First'))).toBe(false);
    expect(root.has(PDFName.of('Last'))).toBe(false);
  });

  it('rejects stale targets, unsafe titles and out-of-range destinations without changing bytes',async()=>{
    const source=await sample();
    await expect(addPdfTopLevelBookmark(source,'  ',1)).rejects.toThrow(/title/i);
    await expect(addPdfTopLevelBookmark(source,'No',5)).rejects.toThrow(/outside/i);
    const original=await addPdfTopLevelBookmark(source,'Keep me',1);
    await expect(renamePdfTopLevelBookmark(original,'999 0 R','Bad')).rejects.toThrow(/no longer exists/i);
    await expect(deletePdfTopLevelBookmark(original,'999 0 R')).rejects.toThrow(/no longer exists/i);
    expect((await listPdfTopLevelBookmarks(original))[0].title).toBe('Keep me');
  });

  it('preserves existing nested bookmark subtrees and refuses their destructive edits',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([400,600]);
    const root=pdf.context.obj({Type:PDFName.of('Outlines'),Count:2});
    const rootRef=pdf.context.register(root);
    const parent=pdf.context.obj({
      Title:PDFHexString.fromText('Section'),
      Parent:rootRef,
      Dest:pdf.context.obj([page.ref,PDFName.of('Fit')]),
      Count:1,
    });
    const parentRef=pdf.context.register(parent);
    const child=pdf.context.obj({
      Title:PDFHexString.fromText('Child'),
      Parent:parentRef,
      Dest:pdf.context.obj([page.ref,PDFName.of('Fit')]),
    });
    const childRef=pdf.context.register(child);
    parent.set(PDFName.of('First'),childRef);
    parent.set(PDFName.of('Last'),childRef);
    root.set(PDFName.of('First'),parentRef);
    root.set(PDFName.of('Last'),parentRef);
    pdf.catalog.set(PDFName.of('Outlines'),rootRef);
    const source=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect((await listPdfTopLevelBookmarks(source))[0]).toMatchObject({title:'Section',editable:false});
    await expect(deletePdfTopLevelBookmark(source,parentRef.toString())).rejects.toThrow(/Nested bookmarks/i);
    const added=await addPdfTopLevelBookmark(source,'Added',1);
    const list=await listPdfTopLevelBookmarks(added);
    expect(list.map(x=>x.title)).toEqual(['Section','Added']);
    const reloaded=await PDFDocument.load(added);
    expect(reloaded.catalog.lookup(PDFName.of('Outlines'),PDFDict)
      .lookup(PDFName.of('Count'),PDFNumber).asNumber()).toBe(3);
  });
});
