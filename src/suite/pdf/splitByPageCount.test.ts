import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName} from 'pdf-lib';
import {unzipSync} from 'fflate';
import {splitPdfByPageCount} from './splitByPageCount';

async function sample(count:number):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  pdf.setTitle('Original stays unchanged');
  for(let i=0;i<count;i++)pdf.addPage([250+i*10,500]);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

describe('native offline PDF count-based splitter',()=>{
  it('refuses PDFs with direct catalog permission signatures',async()=>{
    const doc=await PDFDocument.create();doc.addPage();doc.addPage();
    doc.catalog.set(PDFName.of('Perms'),doc.context.obj({DocMDP:{Type:PDFName.of('Sig')}}));
    await expect(splitPdfByPageCount(Uint8Array.from(await doc.save()),1)).rejects.toThrow(/Certified or usage-rights/);
  });
  it('exports each contiguous group as a reopenable PDF in a real ZIP',async()=>{
    const source=await sample(5);
    const original=Uint8Array.from(source);
    const result=await splitPdfByPageCount(source,2);
    expect(result).toMatchObject({sourcePageCount:5,pageCounts:[2,2,1]});
    const files=unzipSync(result.archive);
    expect(Object.keys(files).sort()).toEqual([
      'part-001.pdf','part-002.pdf','part-003.pdf',
    ]);
    const expectedWidths=[[250,260],[270,280],[290]];
    for(let i=0;i<3;i++){
      const bytes=files['part-'+String(i+1).padStart(3,'0')+'.pdf'];
      expect(new TextDecoder().decode(bytes.slice(0,5))).toBe('%PDF-');
      const pdf=await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(expectedWidths[i].length);
      expect(pdf.getPages().map(page=>page.getSize().width)).toEqual(expectedWidths[i]);
    }
    expect(source).toEqual(original);
  });

  it('rejects output during page generation when the caller archive budget is exhausted',async()=>{
    await expect(splitPdfByPageCount(await sample(5),1,1024)).rejects.toThrow(/archive budget/);
    await expect(splitPdfByPageCount(await sample(5),1,512)).rejects.toThrow(/archive budget/);
  });
  it('supports a single page per part without rewriting the input',async()=>{
    const result=await splitPdfByPageCount(await sample(3),1);
    expect(result.pageCounts).toEqual([1,1,1]);
    expect(Object.keys(unzipSync(result.archive))).toHaveLength(3);
  });

  it('rejects bad counts, invalid documents and unchanged splits',async()=>{
    const source=await sample(4);
    for(const size of [0,-1,1.5,NaN,1001]){
      await expect(splitPdfByPageCount(source,size)).rejects.toThrow(/Pages per part/);
    }
    await expect(splitPdfByPageCount(source,4)).rejects.toThrow(/smaller than/);
    await expect(splitPdfByPageCount(new Uint8Array(0),2)).rejects.toThrow(/128 MB/);
    await expect(splitPdfByPageCount(Uint8Array.from([1,2,3,4,5]),2)).rejects.toThrow();
    await expect(splitPdfByPageCount(await sample(1),1)).rejects.toThrow(/2–1,000 pages/);
    await expect(splitPdfByPageCount(await sample(201),1)).rejects.toThrow(/200 PDFs/);
  });

  it('refuses interactive form PDFs rather than dropping field relationships',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([300,500]);
    pdf.addPage([300,500]);
    const field=pdf.getForm().createTextField('customer');
    field.addToPage(page);
    const source=Uint8Array.from(await pdf.save());
    await expect(splitPdfByPageCount(source,1)).rejects.toThrow(/interactive form/i);
  });

  it('refuses signature-bearing PDFs rather than silently invalidating signatures',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    pdf.context.register(pdf.context.obj({
      Type:PDFName.of('Sig'),ByteRange:[0,10,40,10],
    }));
    await expect(splitPdfByPageCount(Uint8Array.from(await pdf.save()),1))
      .rejects.toThrow(/signature objects/i);
  });
});
