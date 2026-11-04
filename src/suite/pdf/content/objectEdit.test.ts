import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { cropPdfImage, deletePdfObject, insertPdfContent, listPdfPageObjects, replacePdfImage, stylePdfPath, transformPdfObject } from './objectEdit';
import { listPdfTextRuns } from './textEdit';
import { pageContentBytes } from './contentModel';

// 2x1 red PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAQBQEAzYPXwAAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

async function sample(rotate = 0) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  const image = await pdf.embedPng(PNG);
  page.drawImage(image, { x: 100, y: 500, width: 200, height: 100 });
  page.drawRectangle({ x: 350, y: 500, width: 100, height: 50, borderColor: rgb(0, 0, 1), borderWidth: 2 });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Caption', { x: 100, y: 470, size: 12, font });
  if (rotate) page.setRotation(degrees(rotate));
  return pdf.save();
}
const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 0.5);
const content = async (bytes: Uint8Array) => new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(bytes), 0));

describe('image and shape editing (MAL-014, MAL-015)', () => {
  it('lists images and shapes with page and shown boxes', async () => {
    const objects = await listPdfPageObjects(await sample(), 1);
    expect(objects.map((o) => o.kind)).toEqual(['image', 'path']);
    expect(close(objects[0].box, [100, 500, 300, 600])).toBe(true);
    expect(objects[0].pixels).toEqual({ width: 2, height: 1 });
    expect(objects[0].shown.x).toBeCloseTo(100 / 600, 3);
    expect(objects[1].stroke).toBe('#0000ff');
  });

  it('moves, scales and rotates an image in the page as shown', async () => {
    let bytes = await transformPdfObject(await sample(), 1, 'image', 0, { dx: 50, dy: 100 });
    let [image] = await listPdfPageObjects(bytes, 1);
    expect(close(image.box, [150, 400, 350, 500])).toBe(true); // right 50, down 100
    bytes = await transformPdfObject(bytes, 1, 'image', 0, { scale: 0.5 });
    [image] = await listPdfPageObjects(bytes, 1);
    expect(close(image.box, [200, 425, 300, 475])).toBe(true);
    bytes = await transformPdfObject(bytes, 1, 'image', 0, { rotate: 90 });
    [image] = await listPdfPageObjects(bytes, 1);
    expect(close(image.box, [225, 400, 275, 500])).toBe(true); // 100x50 turned to 50x100 about its centre
  });

  it('moves follow the shown page on a rotated page', async () => {
    // On a 90° page, shown "right" is page +y.
    const bytes = await transformPdfObject(await sample(90), 1, 'image', 0, { dx: 40 });
    const [image] = await listPdfPageObjects(bytes, 1, 0);
    expect(close(image.box, [100, 540, 300, 640])).toBe(true);
  });

  it('crops, replaces and deletes images', async () => {
    let bytes = await cropPdfImage(await sample(), 1, 0, { left: 0.25, top: 0, right: 0.25, bottom: 0 });
    expect(await content(bytes)).toMatch(/0\.25 0 0\.5 1 re W n/);
    bytes = await replacePdfImage(bytes, 1, 0, PNG);
    expect(await content(bytes)).toMatch(/MalenjoImg-?\d+ Do/);
    bytes = await deletePdfObject(bytes, 1, 'image', 0);
    expect((await listPdfPageObjects(bytes, 1)).map((o) => o.kind)).toEqual(['path']);
    await expect(replacePdfImage(bytes, 1, 0, new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/PNG or JPEG/);
  });

  it('recolours, moves and deletes vector shapes', async () => {
    let bytes = await stylePdfPath(await sample(), 1, 0, { stroke: '#ff0000', fill: '#00ff00', lineWidth: 4 });
    let [, path] = await listPdfPageObjects(bytes, 1);
    expect([path.stroke, path.fill, path.lineWidth]).toEqual(['#ff0000', '#00ff00', 4]);
    bytes = await transformPdfObject(bytes, 1, 'path', 0, { dx: -50 });
    [, path] = await listPdfPageObjects(bytes, 1);
    expect(path.box[0]).toBeCloseTo(300, 0);
    bytes = await deletePdfObject(bytes, 1, 'path', 0);
    expect((await listPdfPageObjects(bytes, 1)).map((o) => o.kind)).toEqual(['image']);
    expect((await listPdfTextRuns(bytes, 1)).map((r) => r.text)).toEqual(['Caption']);
  });
});

describe('inserting content (MAL-016)', () => {
  it('inserts wrapped text and shapes as page content that can be edited again', async () => {
    let bytes = await insertPdfContent(await sample(), { pageNumber: 1, viewRotation: 0, kind: 'text', rect: { x: 0.1, y: 0.05, width: 0.3, height: 0.1 }, text: 'Approved for payment by finance', fontSize: 14, stroke: '#003366', lineWidth: 1 });
    bytes = await insertPdfContent(bytes, { pageNumber: 1, viewRotation: 0, kind: 'rectangle', rect: { x: 0.5, y: 0.05, width: 0.2, height: 0.05 }, stroke: '#cc0000', fill: '#ffeeee', lineWidth: 2 });
    bytes = await insertPdfContent(bytes, { pageNumber: 1, viewRotation: 0, kind: 'arrow', rect: { x: 0.1, y: 0.9, width: 0.3, height: 0 }, stroke: '#000000', lineWidth: 2 });
    const runs = await listPdfTextRuns(bytes, 1);
    expect(runs.map((r) => r.text)).toEqual(['Caption', 'Approved for payment by', 'finance']); // wrapped at the 180 pt box width
    expect(runs[1].shown.x).toBeCloseTo(0.1, 2);
    const objects = await listPdfPageObjects(bytes, 1);
    expect(objects.filter((o) => o.kind === 'path').length).toBe(5); // original box, new box, arrow line and two head lines
    await expect(insertPdfContent(bytes, { pageNumber: 1, viewRotation: 0, kind: 'text', rect: { x: 0.1, y: 0.1, width: 0.05, height: 0.01 }, text: 'Too much text for a tiny box', fontSize: 14, stroke: '#000000', lineWidth: 1 }))
      .rejects.toThrow(/does not fit/);
  });

  it('inserts upright text on a rotated page', async () => {
    const bytes = await insertPdfContent(await sample(90), { pageNumber: 1, viewRotation: 0, kind: 'text', rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, text: 'Sideways page note', fontSize: 12, stroke: '#000000', lineWidth: 1 });
    const runs = await listPdfTextRuns(bytes, 1);
    const note = runs.find((r) => r.text === 'Sideways page note')!;
    // Upright as shown: wider than tall in the shown frame.
    expect(note.shown.width).toBeGreaterThan(note.shown.height);
    expect(note.shown.x).toBeCloseTo(0.1, 2);
  });
});

describe('cropped images and rotated shapes', () => {
  it('moves the crop with the image, deletes both, and bounds rotated rectangles by all corners', async () => {
    let bytes = await cropPdfImage(await sample(), 1, 0, { left: 0.25, top: 0, right: 0.25, bottom: 0 });
    bytes = await transformPdfObject(bytes, 1, 'image', 0, { dx: 50, dy: 0 });
    // The move wraps the clip and the image together: q <cm> q <re W n> Do Q Q.
    expect((await content(bytes)).replace(/\s+/g, ' ')).toMatch(/q [-\d. ]+ cm q 0\.25 0 0\.5 1 re W n \/\S+ Do Q Q/);
    const [moved] = await listPdfPageObjects(bytes, 1);
    expect(moved.box[0]).toBeCloseTo(150, 0);
    bytes = await deletePdfObject(bytes, 1, 'image', 0);
    expect(await content(bytes)).not.toMatch(/re W n/);
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    page.node.addContentStream(pdf.context.register(pdf.context.stream('q 0.7071 0.7071 -0.7071 0.7071 200 200 cm 0 0 1 rg -50 -50 100 100 re f Q')));
    const [square] = await listPdfPageObjects(await pdf.save(), 1);
    expect(square.box[2] - square.box[0]).toBeCloseTo(141.4, 0);
    expect(square.box[3] - square.box[1]).toBeCloseTo(141.4, 0);
  });
});

describe('content rewriting details', () => {
  it('keeps colours set between a deleted path and its painting, and separates compact operators', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    page.node.addContentStream(pdf.context.register(pdf.context.stream('0 0 100 100 re 1 0 0 rg f 200 0 100 100 re f')));
    let bytes = await pdf.save();
    bytes = await deletePdfObject(bytes, 1, 'path', 0);
    const text = (await content(bytes)).replace(/\s+/g, ' ');
    expect(text).toMatch(/1 0 0 rg 200 0 100 100 re f/);
    expect((await listPdfPageObjects(bytes, 1)).find((o) => o.kind === 'path')?.fill).toBe('#ff0000');
    const compact = await PDFDocument.create();
    const cp = compact.addPage([400, 400]);
    const image = await compact.embedPng(PNG);
    const name = cp.node.newXObject('Im', image.ref).decodeText();
    cp.node.addContentStream(compact.context.register(compact.context.stream(`q 100 0 0 50 10 10 cm/${name} Do Q`)));
    const moved = await transformPdfObject(await compact.save(), 1, 'image', 0, { dx: 10, dy: 0 });
    expect(await content(moved)).not.toMatch(/qq|cmq/);
    expect((await listPdfPageObjects(moved, 1))[0].box[0]).toBeCloseTo(20, 0);
  });

  it('keeps state set inside a moved or restyled path for the content after it', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    page.node.addContentStream(pdf.context.register(pdf.context.stream('0 0 100 100 re 1 0 0 rg f 200 0 100 100 re f')));
    const bytes = await pdf.save();
    for (const edited of [await transformPdfObject(bytes, 1, 'path', 0, { dx: 10, dy: 0 }), await stylePdfPath(bytes, 1, 0, { lineWidth: 3 })]) {
      const paths = (await listPdfPageObjects(edited, 1)).filter((o) => o.kind === 'path');
      expect(paths).toHaveLength(2);
      expect(paths.every((p) => p.fill === '#ff0000')).toBe(true);
    }
  });

  it('moves a path in its construction space and styles it after its own colour', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    page.node.addContentStream(pdf.context.register(pdf.context.stream('0 0 100 100 re 2 0 0 2 0 0 cm f')));
    const moved = await transformPdfObject(await pdf.save(), 1, 'path', 0, { dx: 10, dy: 0 });
    expect((await listPdfPageObjects(moved, 1))[0].box[0]).toBeCloseTo(10, 1);
    const red = await PDFDocument.create();
    red.addPage([400, 400]).node.addContentStream(red.context.register(red.context.stream('0 0 100 100 re 1 0 0 rg f')));
    const green = await stylePdfPath(await red.save(), 1, 0, { fill: '#00ff00' });
    expect((await listPdfPageObjects(green, 1))[0].fill).toBe('#00ff00');
  });

  it('replays only path state that outlives nested scopes, and wraps words wider than an inserted box', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 400]).node.addContentStream(pdf.context.register(pdf.context.stream('0 0 100 100 re q 1 0 0 rg Q f 200 0 100 100 re f')));
    const moved = await transformPdfObject(await pdf.save(), 1, 'path', 0, { dx: 10, dy: 0 });
    const paths = (await listPdfPageObjects(moved, 1)).filter((o) => o.kind === 'path');
    expect(paths.map((p) => p.fill)).toEqual(['#000000', '#000000']);
    const url = 'https://example.com/a/very/long/path/that/does/not/fit';
    const out = await insertPdfContent(await sample(), { pageNumber: 1, viewRotation: 0, kind: 'text', rect: { x: 0.1, y: 0.05, width: 0.2, height: 0.3 }, text: url, fontSize: 12, stroke: '#000000', lineWidth: 1 });
    const runs = (await listPdfTextRuns(out, 1)).filter((r) => r.text !== 'Caption');
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.map((r) => r.text).join('')).toBe(url);
    expect(runs.every((r) => r.box[2] - r.box[0] <= 0.2 * 600 + 0.5)).toBe(true);
  });

  it('refuses inserted lines whose last baseline falls outside the box', async () => {
    const spec = { pageNumber: 1, viewRotation: 0, kind: 'text' as const, rect: { x: 0.1, y: 0.05, width: 0.5, height: 20 / 800 }, fontSize: 12, stroke: '#000000', lineWidth: 1 };
    await expect(insertPdfContent(await sample(), { ...spec, text: 'First line\nSecond line' })).rejects.toThrow(/does not fit the box/);
    expect(await insertPdfContent(await sample(), { ...spec, text: 'One line' })).toBeInstanceOf(Uint8Array);
  });

  it('refuses to move or restyle a path that clips later content, and keeps the clip when deleting it', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 400]).node.addContentStream(pdf.context.register(pdf.context.stream('0 0 100 100 re W f 200 0 100 100 re f')));
    const bytes = await pdf.save();
    await expect(stylePdfPath(bytes, 1, 0, { fill: '#00ff00' })).rejects.toThrow(/clips the content after it/);
    await expect(transformPdfObject(bytes, 1, 'path', 0, { dx: 10, dy: 0 })).rejects.toThrow(/clips the content after it/);
    const removed = await deletePdfObject(bytes, 1, 'path', 0);
    expect((await content(removed)).replace(/\s+/g, ' ')).toMatch(/0 0 100 100 re W n 200 0 100 100 re f/);
    expect((await listPdfPageObjects(removed, 1)).filter((o) => o.kind === 'path')).toHaveLength(1);
  });
});
