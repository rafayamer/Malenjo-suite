import { describe, expect, it } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { batesArchive, batesNumberFiles, batesPlan, type BatesSpec } from './pdfBates';

const SPEC: BatesSpec = { prefix: 'ACME', suffix: '', start: 1, digits: 6, position: 'bottom-right', marginX: 24, marginY: 18, text: { font: 'helvetica', size: 9, color: '#000000' }, continuation: 'continue', roundTo: 100 };
async function doc(pages: number, rotate = 0) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([300, 400]).setRotation(degrees(rotate));
  return pdf.save();
}
async function texts(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice() } as never);
  const d = await loading.promise; const out: { str: string; transform: number[] }[][] = [];
  for (let n = 1; n <= d.numPages; n++) out.push(((await (await d.getPage(n)).getTextContent()).items as { str: string; transform: number[] }[]).filter((i) => i.str.trim()));
  await loading.destroy();
  return out;
}

describe('Bates numbering across files (MAL-067)', () => {
  it('continues, restarts or rounds the counter between files', () => {
    expect(batesPlan(SPEC, [2, 3, 1])).toEqual([1, 3, 6]);
    expect(batesPlan({ ...SPEC, continuation: 'restart' }, [2, 3, 1])).toEqual([1, 1, 1]);
    expect(batesPlan({ ...SPEC, continuation: 'round' }, [2, 3, 1])).toEqual([1, 100, 200]);
    expect(batesPlan({ ...SPEC, continuation: 'round', start: 100 }, [100, 1])).toEqual([100, 200]);
  });

  it('stamps every page of every file in order, upright on rotated pages, with a log', async () => {
    const files = [{ name: 'a.pdf', bytes: await doc(2) }, { name: 'b.pdf', bytes: await doc(3, 90) }, { name: 'c.pdf', bytes: await doc(1) }];
    const result = await batesNumberFiles(files, { ...SPEC, prefix: 'ACME-{vol}-' });
    expect(result.files.map((f) => [f.first, f.last])).toEqual([['ACME-001-000001', 'ACME-001-000002'], ['ACME-002-000003', 'ACME-002-000005'], ['ACME-003-000006', 'ACME-003-000006']]);
    const b = await texts(result.files[1].bytes);
    expect(b.map((p) => p[0].str)).toEqual(['ACME-002-000003', 'ACME-002-000004', 'ACME-002-000005']);
    // On a page turned 90°, the label is drawn turned with it so the reader sees it upright.
    expect(Math.round(b[0][0].transform[1])).toBe(9);
    const a = await texts(result.files[0].bytes);
    expect(a[0][0].transform[4]).toBeGreaterThan(150); expect(a[0][0].transform[5]).toBeLessThan(40); // bottom right
    expect(result.log.split('\r\n')[1]).toMatch(/^a\.pdf,ACME-001-000001,ACME-001-000002,2,[0-9a-f]{64}$/);
    const zip = unzipSync(batesArchive(result));
    expect(Object.keys(zip).sort()).toEqual(['ACME-001-000001_a.pdf', 'ACME-002-000003_b.pdf', 'ACME-003-000006_c.pdf', 'bates-log.csv']);
  });

  it('refuses numbers that do not fit the padding and unreadable files', async () => {
    await expect(batesNumberFiles([{ name: 'a.pdf', bytes: await doc(3) }], { ...SPEC, digits: 2, start: 98 })).rejects.toThrow('more than 2 digits');
    await expect(batesNumberFiles([{ name: 'x.pdf', bytes: new Uint8Array([1, 2, 3]) }], SPEC)).rejects.toThrow('x.pdf could not be read');
  });
});
