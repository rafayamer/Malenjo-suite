import type { PerspectiveQuad, ScanAdjustments } from './types';

export const MAX_SCAN_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SCAN_PIXELS = 25_000_000;
export const MAX_SCAN_PAGES = 50;
export const OCR_MAX_DIMENSION = 3000;

export function validateImageMetadata(type: string, bytes: number, width: number, height: number): string | null {
  if (!/^image\/(png|jpeg|jpg|webp|bmp|tiff?)$/i.test(type)) {
    return 'Unsupported image type. Use PNG, JPEG, WebP, BMP or TIFF.';
  }
  if (bytes <= 0 || bytes > MAX_SCAN_FILE_BYTES) {
    return 'Image exceeds the 25 MB per-page safety limit.';
  }
  if (width <= 0 || height <= 0 || width * height > MAX_SCAN_PIXELS) {
    return 'Image exceeds the 25 megapixel per-page safety limit.';
  }
  return null;
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function normalizePerspective(value: PerspectiveQuad): PerspectiveQuad {
  return {
    tlx: clampUnit(value.tlx), tly: clampUnit(value.tly),
    trx: clampUnit(value.trx), try: clampUnit(value.try),
    brx: clampUnit(value.brx), bry: clampUnit(value.bry),
    blx: clampUnit(value.blx), bly: clampUnit(value.bly),
  };
}

export function bilinearSource(
  u: number,
  v: number,
  quad: PerspectiveQuad,
): { x: number; y: number } {
  const q = normalizePerspective(quad);
  const topX = q.tlx + (q.trx - q.tlx) * u;
  const topY = q.tly + (q.try - q.tly) * u;
  const bottomX = q.blx + (q.brx - q.blx) * u;
  const bottomY = q.bly + (q.bry - q.bly) * u;
  return {
    x: topX + (bottomX - topX) * v,
    y: topY + (bottomY - topY) * v,
  };
}

async function loadImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to decode scan image.'));
    image.src = sourceUrl;
  });
}

function perspectiveWarp(canvas: HTMLCanvasElement, quad: PerspectiveQuad): HTMLCanvasElement {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas image processing is unavailable.');

  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const target = document.createElement('canvas');
  target.width = canvas.width;
  target.height = canvas.height;
  const targetContext = target.getContext('2d');
  if (!targetContext) throw new Error('Canvas perspective processing is unavailable.');
  const output = targetContext.createImageData(target.width, target.height);

  const sourceData = source.data;
  const targetData = output.data;
  const width = source.width;
  const height = source.height;

  for (let y = 0; y < height; y += 1) {
    const v = height <= 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = width <= 1 ? 0 : x / (width - 1);
      const point = bilinearSource(u, v, quad);
      const sx = Math.min(width - 1, Math.max(0, Math.round(point.x * (width - 1))));
      const sy = Math.min(height - 1, Math.max(0, Math.round(point.y * (height - 1))));
      const sourceOffset = (sy * width + sx) * 4;
      const targetOffset = (y * width + x) * 4;
      targetData[targetOffset] = sourceData[sourceOffset];
      targetData[targetOffset + 1] = sourceData[sourceOffset + 1];
      targetData[targetOffset + 2] = sourceData[sourceOffset + 2];
      targetData[targetOffset + 3] = sourceData[sourceOffset + 3];
    }
  }

  targetContext.putImageData(output, 0, 0);
  return target;
}

function rotateCanvas(canvas: HTMLCanvasElement, rotation: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (rotation === 0) return canvas;

  const target = document.createElement('canvas');
  const swap = rotation === 90 || rotation === 270;
  target.width = swap ? canvas.height : canvas.width;
  target.height = swap ? canvas.width : canvas.height;
  const context = target.getContext('2d');
  if (!context) throw new Error('Canvas rotation is unavailable.');

  context.translate(target.width / 2, target.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return target;
}

function scaleCanvas(canvas: HTMLCanvasElement, maxDimension: number): HTMLCanvasElement {
  const longest = Math.max(canvas.width, canvas.height);
  if (longest <= maxDimension) return canvas;

  const ratio = maxDimension / longest;
  const target = document.createElement('canvas');
  target.width = Math.max(1, Math.round(canvas.width * ratio));
  target.height = Math.max(1, Math.round(canvas.height * ratio));
  const context = target.getContext('2d');
  if (!context) throw new Error('Canvas scaling is unavailable.');
  context.drawImage(canvas, 0, 0, target.width, target.height);
  return target;
}

export async function renderProcessedScan(
  sourceUrl: string,
  adjustments: ScanAdjustments,
  maxDimension = 2200,
): Promise<HTMLCanvasElement> {
  const image = await loadImage(sourceUrl);
  const crop = adjustments.crop;
  const sx = Math.round(clampUnit(crop.x) * image.width);
  const sy = Math.round(clampUnit(crop.y) * image.height);
  const sw = Math.max(1, Math.round(clampUnit(crop.width) * image.width));
  const sh = Math.max(1, Math.round(clampUnit(crop.height) * image.height));

  let canvas = document.createElement('canvas');
  canvas.width = Math.min(sw, image.width - sx);
  canvas.height = Math.min(sh, image.height - sy);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas scan processing is unavailable.');

  context.filter = `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%)${adjustments.grayscale ? ' grayscale(100%)' : ''}`;
  context.drawImage(
    image,
    sx, sy, canvas.width, canvas.height,
    0, 0, canvas.width, canvas.height,
  );
  context.filter = 'none';

  canvas = scaleCanvas(canvas, maxDimension);
  if (adjustments.perspectiveEnabled) {
    canvas = perspectiveWarp(canvas, adjustments.perspective);
  }
  canvas = rotateCanvas(canvas, adjustments.rotation);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Unable to encode processed scan.')), type, quality);
  });
}

export async function imageDimensions(url: string): Promise<{ width: number; height: number }> {
  const image = await loadImage(url);
  return { width: image.width, height: image.height };
}
