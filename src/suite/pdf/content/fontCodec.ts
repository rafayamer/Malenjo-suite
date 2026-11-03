/**
 * Font decoding and re-encoding for native text editing (MAL-011).
 *
 * Decoding (bytes -> Unicode) uses the font's ToUnicode CMap when present,
 * otherwise its /Encoding (base encoding plus /Differences glyph names).
 * Encoding (Unicode -> bytes) only produces codes the font can draw:
 *  - standard 14 fonts that are not embedded: every code with a glyph;
 *  - embedded subset fonts: only codes already used with this font in the
 *    document (a subset contains just those glyphs);
 *  - other embedded fonts: codes with a width in /Widths (or /W).
 * Anything else is reported as missing, never silently drawn wrong.
 */
import { Encodings, Font, type IFontNames } from '@pdf-lib/standard-fonts';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';

const N = (name: string) => PDFName.of(name);
/** Typed lookup that returns undefined (instead of throwing) when the value has another type. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function get<T>(pdf: PDFDocument, dict: PDFDict | undefined, key: string, type: Function & { prototype: T }): T | undefined {
  const value = dict?.get(N(key));
  const resolved = value === undefined ? undefined : pdf.context.lookup(value);
  return resolved instanceof type ? resolved as T : undefined;
}
const STANDARD = new Set(['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique',
  'Helvetica-BoldOblique', 'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Symbol', 'ZapfDingbats']);
const ALIASES: Record<string, string> = { Arial: 'Helvetica', 'Arial,Bold': 'Helvetica-Bold', TimesNewRoman: 'Times-Roman', 'TimesNewRoman,Bold': 'Times-Bold', CourierNew: 'Courier' };

/** WinAnsi code -> [unicode, glyph name], and glyph name -> unicode, from pdf-lib's tables. */
const WIN_ANSI = new Map<number, [string, string]>();
const NAME_TO_UNICODE = new Map<string, string>();
for (const cp of Encodings.WinAnsi.supportedCodePoints) {
  const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
  WIN_ANSI.set(code, [String.fromCodePoint(cp), name]);
  // Several code points can share a glyph name (space / no-break space): keep the lowest.
  if (!NAME_TO_UNICODE.has(name)) NAME_TO_UNICODE.set(name, String.fromCodePoint(cp));
}
function glyphToUnicode(name: string): string | null {
  if (NAME_TO_UNICODE.has(name)) return NAME_TO_UNICODE.get(name)!;
  const uni = /^uni([0-9A-F]{4})$/i.exec(name) ?? /^u([0-9A-F]{4,6})$/i.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16));
  return name.length === 1 ? name : null;
}

export interface FontCodec {
  key: string;
  baseFont: string;
  kind: 'simple' | 'type0' | 'type3';
  subset: boolean;
  embedded: boolean;
  bytesPerCode: 1 | 2;
  /** Splits bytes into codes. */
  codes(bytes: Uint8Array): number[];
  /** Unicode for a code, or null when the font gives no mapping. */
  unicode(code: number): string | null;
  /** Advance width in thousandths of the font size. */
  width(code: number): number;
  /** Codes seen with this font anywhere in the document (filled by the caller). */
  used: Set<number>;
  /** Encodes text, or lists the characters this font cannot draw. */
  encode(text: string): { bytes: Uint8Array } | { missing: string[] };
}

function parseToUnicode(stream: PDFStream | undefined): Map<number, string> {
  const map = new Map<number, string>();
  if (!stream) return map;
  const raw = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  const text = new TextDecoder('latin1').decode(raw);
  const hexText = (hex: string) => { let s = ''; for (let i = 0; i + 3 < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16)); return s; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hexText(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (hi - lo > 65535) continue;
      if (m[3].startsWith('[')) {
        [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((d, k) => { if (lo + k <= hi) map.set(lo + k, hexText(d[1])); });
      } else {
        const base = m[3].slice(1, -1);
        const last = parseInt(base.slice(-4), 16);
        for (let c = lo; c <= hi; c++) map.set(c, hexText(base.slice(0, -4)) + String.fromCharCode(last + c - lo));
      }
    }
  }
  return map;
}

export function fontCodec(pdf: PDFDocument, key: string, dict: PDFDict): FontCodec {
  const subtype = dict.get(N('Subtype'))?.toString().slice(1) ?? '';
  const baseFont = (dict.get(N('BaseFont'))?.toString().slice(1) ?? key).replace(/#20/g, ' ');
  const subset = /^[A-Z]{6}\+/.test(baseFont);
  const plainName = baseFont.replace(/^[A-Z]{6}\+/, '');
  const toUnicode = parseToUnicode(get(pdf, dict, 'ToUnicode', PDFStream));
  const used = new Set<number>();

  if (subtype === 'Type0') {
    const descendantRef = get(pdf, dict, 'DescendantFonts', PDFArray)?.get(0);
    const descendant = descendantRef ? (pdf.context.lookup(descendantRef) instanceof PDFDict ? pdf.context.lookup(descendantRef) as PDFDict : undefined) : undefined;
    const descriptor = get(pdf, descendant, 'FontDescriptor', PDFDict);
    const embedded = !!descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor.has(N(k)));
    const defaultWidth = get(pdf, descendant, 'DW', PDFNumber)?.asNumber() ?? 1000;
    const widths = new Map<number, number>();
    const w = get(pdf, descendant, 'W', PDFArray)?.asArray().map((v) => pdf.context.lookup(v)) ?? [];
    for (let k = 0; k < w.length;) {
      const first = (w[k] as PDFNumber).asNumber();
      const next = w[k + 1];
      if (next instanceof PDFArray) { next.asArray().forEach((v, j) => widths.set(first + j, (pdf.context.lookup(v) as PDFNumber).asNumber())); k += 2; }
      else { const last = (next as PDFNumber).asNumber(); const width = (w[k + 2] as PDFNumber).asNumber(); for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, width); k += 3; }
    }
    const reverse = new Map<string, number>();
    toUnicode.forEach((text, code) => { if (!reverse.has(text)) reverse.set(text, code); });
    const identity = dict.get(N('Encoding'))?.toString() === '/Identity-H';
    return {
      key, baseFont, kind: 'type0', subset, embedded, bytesPerCode: 2, used,
      codes: (bytes) => Array.from({ length: bytes.length >> 1 }, (_, k) => (bytes[2 * k] << 8) | bytes[2 * k + 1]),
      unicode: (code) => toUnicode.get(code) ?? null,
      width: (code) => widths.get(code) ?? defaultWidth,
      encode(text) {
        if (!identity) return { missing: [...new Set([...text])] };
        const out: number[] = []; const missing: string[] = [];
        for (const ch of text) {
          const code = reverse.get(ch);
          if (code === undefined || (subset && !used.has(code))) missing.push(ch); else out.push(code >> 8, code & 255);
        }
        return missing.length ? { missing: [...new Set(missing)] } : { bytes: Uint8Array.from(out) };
      },
    };
  }

  // Simple fonts (Type1, TrueType, MMType1) and Type3.
  const descriptor = get(pdf, dict, 'FontDescriptor', PDFDict);
  const embedded = !!descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor.has(N(k)));
  const standardName = ALIASES[plainName] ?? plainName;
  const standard = !embedded && STANDARD.has(standardName) ? Font.load(standardName as IFontNames) : null;
  const symbolic = standardName === 'Symbol' || standardName === 'ZapfDingbats';
  const glyphNames = new Map<number, string>();
  WIN_ANSI.forEach(([, name], code) => glyphNames.set(code, name));
  const encodingDict = get(pdf, dict, 'Encoding', PDFDict);
  const differences = get(pdf, encodingDict, 'Differences', PDFArray)?.asArray() ?? [];
  let cursor = 0;
  for (const item of differences) {
    const value = pdf.context.lookup(item);
    if (value instanceof PDFNumber) cursor = value.asNumber();
    else if (value instanceof PDFName) glyphNames.set(cursor++, value.decodeText());
  }
  const firstChar = get(pdf, dict, 'FirstChar', PDFNumber)?.asNumber() ?? 0;
  const widthArray = get(pdf, dict, 'Widths', PDFArray)?.asArray().map((v) => { const n = pdf.context.lookup(v); return n instanceof PDFNumber ? n.asNumber() : 0; });
  const missingWidth = get(pdf, descriptor, 'MissingWidth', PDFNumber)?.asNumber() ?? 0;
  const unicodeOf = (code: number): string | null => {
    if (toUnicode.has(code)) return toUnicode.get(code)!;
    if (symbolic) return null;
    const name = glyphNames.get(code);
    return name ? glyphToUnicode(name) : null;
  };
  const widthOf = (code: number): number => {
    if (widthArray && code >= firstChar && code < firstChar + widthArray.length) return widthArray[code - firstChar];
    if (standard) { const name = glyphNames.get(code); const w = name ? standard.getWidthOfGlyph(name) : undefined; if (typeof w === 'number') return w; }
    return missingWidth;
  };
  const drawable = (code: number): boolean => {
    if (subtype === 'Type3') return used.has(code);
    if (subset) return used.has(code);
    if (standard) { const name = glyphNames.get(code); return !!name && typeof standard.getWidthOfGlyph(name) === 'number'; }
    return widthOf(code) > 0 || used.has(code);
  };
  const reverse = new Map<string, number>();
  for (let code = 0; code < 256; code++) { const u = unicodeOf(code); if (u && !reverse.has(u)) reverse.set(u, code); }
  return {
    key, baseFont, kind: subtype === 'Type3' ? 'type3' : 'simple', subset, embedded, bytesPerCode: 1, used,
    codes: (bytes) => Array.from(bytes),
    unicode: unicodeOf,
    width: widthOf,
    encode(text) {
      const out: number[] = []; const missing: string[] = [];
      for (const ch of text) {
        const code = reverse.get(ch);
        if (code === undefined || !drawable(code)) missing.push(ch); else out.push(code);
      }
      return missing.length ? { missing: [...new Set(missing)] } : { bytes: Uint8Array.from(out) };
    },
  };
}
