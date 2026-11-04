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
    expect(await content(bytes)).toMatch(/q [-\d. ]+ cm q 0\.25 0 0\.5 1 re W n \/\S+ Do Q Q/);
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
