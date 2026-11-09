/** The reusable stamp library (MAL-057): built-in designs plus the user's own, kept on this device. */
import { BUILT_IN_STAMPS, checkStampDesign, type StampDesign } from './pdfDynamicStamp';

const KEY = 'malenjo.pdf.stamps.v1';
const MAX = 100;

export function loadStampLibrary(): StampDesign[] {
  let custom: StampDesign[] = [];
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]');
    if (Array.isArray(parsed)) custom = parsed.filter((d): d is StampDesign => {
      try { checkStampDesign(d); return typeof d.id === 'string' && !d.builtIn; } catch { return false; }
    }).slice(0, MAX);
  } catch { custom = []; }
  return [...BUILT_IN_STAMPS, ...custom];
}

/** Saves the user's own designs (built-in ones are never stored). Returns false when storage is unavailable. */
export function saveStampLibrary(designs: StampDesign[]): boolean {
  const custom = designs.filter((d) => !d.builtIn).slice(0, MAX).map(({ id, name, status, detail, color }) => ({ id, name, status, detail, color }));
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(custom)); return !!globalThis.localStorage; } catch { return false; }
}
