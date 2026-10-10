import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName} from 'pdf-lib';
import {unzipSync} from 'fflate';
import {addPdfOutlineTreeEntry} from './pdfOutlineTree';
import {splitPdfByChapters,PDF_CHAPTER_SPLIT_MAX_PAGES} from './pdfChapterSplit';

async function source(count=5){
  const pdf=await PDFDocument.create();
  for(let index=0;index<count;index++)pdf.addPage([200+index*10,300]);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
async function bookmark(pdf:Uint8Array,pairs:Array<[string,number]>){
  let bytes=pdf;
  for(const [title,page] of pairs){
    bytes=await addPdfOutlineTreeEntry(bytes,title,page);
  }
  return bytes;
}

describe('native offline chapter splitter',()=>{
  it('exports complete, ordered, reopenable chapters using real top-level PDF outlines',async()=>{
    const original=await bookmark(await source(),[
      ['Introduction',1],['Research',3],['Conclusion',5],
    ]);
    const snapshot=Uint8Array.from(original);
    const result=await splitPdfByChapters(original);
    expect(original).toEqual(snapshot);
    expect(result.sourcePageCount).toBe(5);
    expect(result.chapters.map(x=>[x.firstPage,x.lastPage])).toEqual([
      [1,2],[3,4],[5,5],
    ]);
    const files=unzipSync(result.archive);
    expect(Object.keys(files).sort()).toEqual([
      'chapter-001-introduction.pdf','chapter-002-research.pdf',
      'chapter-003-conclusion.pdf',
    ]);
    for(const [index,entry] of result.chapters.entries()){
      const part=await PDFDocument.load(files[entry.filename]);
      expect(part.getPageCount()).toBe(entry.lastPage-entry.firstPage+1);
      expect(part.getPages().map(page=>page.getWidth())).toEqual(
        Array.from({length:entry.lastPage-entry.firstPage+1},(_,p)=>
          200+(entry.firstPage-1+p)*10,
        ),
      );
      expect(index).toBeGreaterThanOrEqual(0);
    }
  });

  it('creates separate front matter when the first bookmark starts after page one',async()=>{
    const data=await bookmark(await source(),[['Part One',2],['Part Two',4]]);
    const result=await splitPdfByChapters(data);
    expect(result.chapters.map(x=>[x.name,x.firstPage,x.lastPage])).toEqual([
      ['Front matter',1,1],['Part One',2,3],['Part Two',4,5],
    ]);
  });

  it('sanitizes chapter titles as inert filenames and never allows ZIP traversal',async()=>{
    const data=await bookmark(await source(),[
      ['../Invoices/../../Sensitive',1],['Other folder',3],
    ]);
    const result=await splitPdfByChapters(data);
    expect(Object.keys(unzipSync(result.archive)).every(name=>
      /^chapter-\d{3}-[a-z0-9-]+\.pdf$/.test(name)&&!name.includes('..')
    )).toBe(true);
  });

  it('rejects missing, unordered and duplicate bookmark page destinations',async()=>{
    await expect(splitPdfByChapters(await source())).rejects.toThrow(/no top-level/);
    const onlyOne=await bookmark(await source(),[['Start',1]]);
    await expect(splitPdfByChapters(onlyOne)).rejects.toThrow(/At least two/);
    const unordered=await bookmark(await source(),[['Second',3],['First',2]]);
    await expect(splitPdfByChapters(unordered)).rejects.toThrow(/strictly increasing/);
    const repeated=await bookmark(await source(),[['First',1],['Again',1]]);
    await expect(splitPdfByChapters(repeated)).rejects.toThrow(/strictly increasing/);
  });

  it('refuses interactive form fields and certified PDFs, preserving source',async()=>{
    const data=await bookmark(await source(),[['One',1],['Two',3]]);
    const form=await PDFDocument.load(data);
    const before=form.getPageCount();
    form.getForm().createTextField('customer');
    const formBytes=Uint8Array.from(await form.save());
    await expect(splitPdfByChapters(formBytes)).rejects.toThrow(/interactive form/);
    expect(before).toBe(5);
    const signed=await PDFDocument.load(data);
    signed.catalog.set(PDFName.of('Perms'),signed.context.obj({DocMDP:{}}));
    await expect(splitPdfByChapters(Uint8Array.from(await signed.save())))
      .rejects.toThrow(/certified/);
  });

  it('rejects malformed sizes, page budgets and insufficient ZIP capacity',async()=>{
    expect(PDF_CHAPTER_SPLIT_MAX_PAGES).toBe(200);
    await expect(splitPdfByChapters(new Uint8Array())).rejects.toThrow(/32 MB/);
    const data=await bookmark(await source(),[['One',1],['Two',3]]);
    await expect(splitPdfByChapters(data,512)).rejects.toThrow(/between 1 KB/);
    await expect(splitPdfByChapters(data,1024)).rejects.toThrow(/ZIP archive budget/);
    await expect(splitPdfByChapters(await source(201))).rejects.toThrow(/2 to 200/);
  });
});
