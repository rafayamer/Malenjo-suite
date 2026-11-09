/**
 * Document preflight (MAL-068): checks the conditions MALENJO supports for PDF/A (1b, 2b, 3b), PDF/X (1a, 4) and
 * PDF/UA-1 — fonts, colour spaces, transparency, output intents, metadata, actions, attachments, annotations,
 * tagging and page boxes — and reports each as passed or failed, with where it fails.
 *
 * It is a structural checker for the listed conditions, not a certified validator: a pass here means none of these
 * conditions failed, not that every clause of the standard was proven (use veraPDF or an equivalent for that).
 */
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, type PDFObject } from 'pdf-lib';
import { tokenizeContent } from '../content/contentLexer';
import { decodedStream } from './redactWalker';

export type PreflightProfile = 'pdfa-1b' | 'pdfa-2b' | 'pdfa-3b' | 'pdfx-1a' | 'pdfx-4' | 'pdfua-1';
export const PREFLIGHT_PROFILES: [PreflightProfile, string][] = [
  ['pdfa-1b', 'PDF/A-1b (archiving)'], ['pdfa-2b', 'PDF/A-2b (archiving)'], ['pdfa-3b', 'PDF/A-3b (archiving with attachments)'],
  ['pdfx-1a', 'PDF/X-1a (print, CMYK and spot only)'], ['pdfx-4', 'PDF/X-4 (print, colour managed)'], ['pdfua-1', 'PDF/UA-1 (accessibility)'],
];
export type CheckGroup = 'Fonts' | 'Colour' | 'Transparency' | 'Metadata' | 'Actions and content' | 'Annotations and forms' | 'Tagging' | 'Structure' | 'Page boxes';
export interface PreflightCheck { id: string; group: CheckGroup; label: string; passed: boolean; details: string[] }
export interface PreflightResult { profile: PreflightProfile; name: string; passed: boolean; checks: PreflightCheck[] }

const N = PDFName.of;
const MAX_WALK = 200_000;
const name = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : undefined);
const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined);
const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);

/** What the document uses, gathered in one pass. */
interface Facts {
  version: number; binaryHeader: boolean; encrypted: boolean; hasId: boolean;
  fonts: Map<string, { embedded: boolean; where: string }>;
  spaces: Map<string, Set<string>>; // device space -> where
  spot: number; iccOrLab: number;
  transparency: string[];
  lzw: string[];
  scripts: string[];
  attachments: { name: string; relationship?: string }[];
  outputIntents: { s: string; profile: boolean }[];
  xmp: string | null;
  annotations: { page: number; subtype: string; hasAppearance: boolean; printFlag: boolean; hidden: boolean }[];
  needAppearances: boolean; optionalContent: boolean;
  pages: { trim: boolean; art: boolean; bleedInside: boolean; tabs: string | undefined; annots: number }[];
  marked: boolean; structTree: PDFDict | undefined; lang: string | undefined; displayTitle: boolean; title: string | undefined;
  figuresWithoutAlt: number; figures: number; info: PDFDict | undefined;
}

function gather(pdf: PDFDocument, bytes: Uint8Array): Facts {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64));
  const version = Number(/%PDF-(\d\.\d)/.exec(head)?.[1] ?? 0);
  const binaryHeader = /^%PDF-\d\.\d\r?\n?%[\x80-\xff]{4}/.test(head.replace(/\r\n/, '\n'));
  const ctx = pdf.context;
  const lookup = (o: PDFObject | undefined) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const f: Facts = {
    version, binaryHeader, encrypted: !!ctx.trailerInfo.Encrypt, hasId: !!ctx.trailerInfo.ID, fonts: new Map(), spaces: new Map(), spot: 0, iccOrLab: 0,
    transparency: [], lzw: [], scripts: [], attachments: [], outputIntents: [], xmp: null, annotations: [], needAppearances: false, optionalContent: false,
    pages: [], marked: false, structTree: undefined, lang: undefined, displayTitle: false, title: undefined, figuresWithoutAlt: 0, figures: 0,
    info: lookup(ctx.trailerInfo.Info) as PDFDict | undefined,
  };
  const useSpace = (space: string, where: string) => { if (!f.spaces.has(space)) f.spaces.set(space, new Set()); f.spaces.get(space)!.add(where); };
  const colourSpace = (cs: PDFObject | undefined, where: string, depth = 0): void => {
    const value = lookup(cs);
    if (depth > 8 || !value) return;
    const n = name(value);
    if (n) { if (['DeviceRGB', 'DeviceCMYK', 'DeviceGray', 'RGB', 'CMYK', 'G'].includes(n)) useSpace({ RGB: 'DeviceRGB', CMYK: 'DeviceCMYK', G: 'DeviceGray' }[n] ?? n, where); return; }
    if (!(value instanceof PDFArray)) return;
    const family = name(value.get(0));
    if (family === 'ICCBased' || family === 'Lab' || family === 'CalRGB' || family === 'CalGray') f.iccOrLab++;
    else if (family === 'Separation' || family === 'DeviceN') { f.spot++; colourSpace(value.get(2), where, depth + 1); }
    else if (family === 'Indexed') colourSpace(value.get(1), where, depth + 1);
    else if (family === 'Pattern' && value.size() > 1) colourSpace(value.get(1), where, depth + 1);
  };
  const filters = (dict: PDFDict, where: string) => {
    const filter = dict.get(N('Filter'));
    const list = filter instanceof PDFArray ? filter.asArray().map(name) : [name(filter)];
    if (list.some((x) => x === 'LZWDecode' || x === 'LZW')) f.lzw.push(where);
  };
  const seenResources = new Set<PDFDict>(); const seenFonts = new Set<PDFDict>();
  let walked = 0;
  const resources = (res: PDFDict | undefined, where: string, depth: number): void => {
    if (!res || seenResources.has(res) || depth > 16 || ++walked > MAX_WALK) return;
    seenResources.add(res);
    const fonts = lookup(res.get(N('Font')));
    if (fonts instanceof PDFDict) for (const [key, ref] of fonts.entries()) {
      const font = lookup(ref);
      if (!(font instanceof PDFDict) || seenFonts.has(font)) continue;
      seenFonts.add(font);
      const subtype = name(font.get(N('Subtype')));
      const base = name(font.get(N('BaseFont'))) ?? key.decodeText();
      if (subtype === 'Type3') { resources(lookup(font.get(N('Resources'))) as PDFDict | undefined, `${where}, Type 3 font ${base}`, depth + 1); continue; }
      const descendant = subtype === 'Type0' ? lookup((lookup(font.get(N('DescendantFonts'))) as PDFArray | undefined)?.get(0)) as PDFDict | undefined : font;
      const descriptor = lookup(descendant?.get(N('FontDescriptor'))) as PDFDict | undefined;
      const embedded = !!descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor.has(N(k)));
      if (!f.fonts.has(base) || !embedded) f.fonts.set(base, { embedded, where });
    }
    const gs = lookup(res.get(N('ExtGState')));
    if (gs instanceof PDFDict) for (const [key, ref] of gs.entries()) {
      const state = lookup(ref);
      if (!(state instanceof PDFDict)) continue;
      const smask = state.get(N('SMask'));
      const bm = name(lookup(state.get(N('BM')))) ?? (lookup(state.get(N('BM'))) instanceof PDFArray ? name((lookup(state.get(N('BM'))) as PDFArray).get(0)) : undefined);
      const ca = num(state.get(N('ca'))), CA = num(state.get(N('CA')));
      if ((smask && name(smask) !== 'None') || (ca !== undefined && ca < 1) || (CA !== undefined && CA < 1) || (bm && bm !== 'Normal' && bm !== 'Compatible')) f.transparency.push(`${where}: graphics state ${key.decodeText()}`);
    }
    const spaces = lookup(res.get(N('ColorSpace')));
    if (spaces instanceof PDFDict) for (const [, cs] of spaces.entries()) colourSpace(cs, where);
    const shadings = lookup(res.get(N('Shading')));
    if (shadings instanceof PDFDict) for (const [, sh] of shadings.entries()) { const d = lookup(sh); colourSpace(d instanceof PDFDict ? d.get(N('ColorSpace')) : d instanceof PDFStream ? d.dict.get(N('ColorSpace')) : undefined, where); }
    const patterns = lookup(res.get(N('Pattern')));
    if (patterns instanceof PDFDict) for (const [key, p] of patterns.entries()) { const pat = lookup(p); if (pat instanceof PDFStream) stream(pat, `${where}, pattern ${key.decodeText()}`, depth + 1); }
    const xobjects = lookup(res.get(N('XObject')));
    if (xobjects instanceof PDFDict) for (const [key, x] of xobjects.entries()) {
      const object = lookup(x);
      if (!(object instanceof PDFStream)) continue;
      const kind = name(object.dict.get(N('Subtype')));
      const label = `${where}, ${kind === 'Image' ? 'image' : 'drawing'} ${key.decodeText()}`;
      filters(object.dict, label);
      if (kind === 'Image') {
        if (object.dict.get(N('ImageMask')) !== PDFBool.True) colourSpace(object.dict.get(N('ColorSpace')), label);
        if (object.dict.has(N('SMask'))) f.transparency.push(`${label}: soft mask`);
      } else if (kind === 'Form') stream(object, label, depth + 1);
    }
  };
  const groupTransparency = (dict: PDFDict, where: string) => {
    const group = lookup(dict.get(N('Group')));
    if (group instanceof PDFDict && name(group.get(N('S'))) === 'Transparency') f.transparency.push(`${where}: transparency group`);
  };
  /** A content stream (page or form): colour operators, then its resources. */
  const stream = (s: PDFStream | Uint8Array, where: string, depth: number, res?: PDFDict) => {
    if (depth > 16 || ++walked > MAX_WALK) return;
    let data: Uint8Array;
    if (s instanceof PDFStream) { groupTransparency(s.dict, where); filters(s.dict, where); res = lookup(s.dict.get(N('Resources'))) as PDFDict | undefined ?? res; try { data = decodedStream(s); } catch { return; } } else data = s;
    try {
      for (const op of tokenizeContent(data)) {
        if (op.op === 'rg' || op.op === 'RG') useSpace('DeviceRGB', where);
        else if (op.op === 'k' || op.op === 'K') useSpace('DeviceCMYK', where);
        else if (op.op === 'g' || op.op === 'G') useSpace('DeviceGray', where);
        else if ((op.op === 'cs' || op.op === 'CS') && op.operands[0]?.type === 'name') {
          const n = op.operands[0].value;
          if (['DeviceRGB', 'DeviceCMYK', 'DeviceGray'].includes(n)) useSpace(n, where);
        }
      }
    } catch { /* an unreadable stream is reported by the structure check */ }
    resources(res, where, depth + 1);
  };

  pdf.getPages().forEach((page, i) => {
    const where = `Page ${i + 1}`;
    const node = page.node;
    groupTransparency(node, where);
    const contents = lookup(node.get(N('Contents')));
    const parts = contents instanceof PDFArray ? contents.asArray().map(lookup) : [contents];
    const res = node.Resources();
    for (const part of parts) if (part instanceof PDFStream) { filters(part.dict, where); stream(part, where, 0, res); }
    resources(res, where, 0);
    const annots = (lookup(node.get(N('Annots'))) as PDFArray | undefined)?.asArray() ?? [];
    for (const ref of annots) {
      const a = lookup(ref);
      if (!(a instanceof PDFDict)) continue;
      const subtype = name(a.get(N('Subtype'))) ?? '?';
      const flags = num(a.get(N('F'))) ?? 0;
      const ap = lookup(a.get(N('AP')));
      const normal = ap instanceof PDFDict ? lookup(ap.get(N('N'))) : undefined;
      f.annotations.push({ page: i + 1, subtype, hasAppearance: !!normal, printFlag: (flags & 4) !== 0, hidden: (flags & 2) !== 0 || (flags & 32) !== 0 });
      if (normal instanceof PDFStream) stream(normal, `${where}, ${subtype} annotation`, 1);
      else if (normal instanceof PDFDict) for (const [, s] of normal.entries()) { const st = lookup(s); if (st instanceof PDFStream) stream(st, `${where}, ${subtype} annotation`, 1); }
      const action = lookup(a.get(N('A')));
      const s = action instanceof PDFDict ? name(action.get(N('S'))) : undefined;
      if (s && ['JavaScript', 'Launch', 'Sound', 'Movie', 'ResetForm', 'ImportData', 'Hide', 'SetOCGState', 'Rendition', 'Trans', 'GoTo3DView'].includes(s)) f.scripts.push(`${where}: ${subtype} annotation ${s} action`);
      if (a.has(N('AA'))) f.scripts.push(`${where}: ${subtype} annotation additional actions`);
    }
    if (node.has(N('AA'))) f.scripts.push(`${where}: page additional actions`);
    const box = (k: string) => (lookup(node.get(N(k))) as PDFArray | undefined)?.asArray().map((v) => num(v) ?? 0);
    const mb = page.getMediaBox();
    const media = box('MediaBox') ?? [mb.x, mb.y, mb.x + mb.width, mb.y + mb.height];
    const bleed = box('BleedBox');
    const inside = (b?: number[]) => !b || !media || (b[0] >= media[0] - 0.01 && b[1] >= media[1] - 0.01 && b[2] <= media[2] + 0.01 && b[3] <= media[3] + 0.01);
    f.pages.push({ trim: !!box('TrimBox'), art: !!box('ArtBox'), bleedInside: inside(bleed) && inside(box('TrimBox')), tabs: name(node.get(N('Tabs'))), annots: annots.length });
  });

  const catalog = pdf.catalog;
  const names = lookup(catalog.get(N('Names'))) as PDFDict | undefined;
  if (names?.has(N('JavaScript'))) f.scripts.push('Document JavaScript');
  const open = lookup(catalog.get(N('OpenAction')));
  if (open instanceof PDFDict && ['JavaScript', 'Launch'].includes(name(open.get(N('S'))) ?? '')) f.scripts.push(`Open action (${name(open.get(N('S')))})`);
  if (catalog.has(N('AA'))) f.scripts.push('Document additional actions');
  const files = (lookup((lookup(names?.get(N('EmbeddedFiles'))) as PDFDict | undefined)?.get(N('Names'))) as PDFArray | undefined)?.asArray() ?? [];
  for (let k = 0; k + 1 < files.length; k += 2) {
    const spec = lookup(files[k + 1]) as PDFDict | undefined;
    f.attachments.push({ name: text(lookup(files[k])) ?? '?', relationship: name(spec?.get(N('AFRelationship'))) });
  }
  for (const ref of (lookup(catalog.get(N('OutputIntents'))) as PDFArray | undefined)?.asArray() ?? []) {
    const intent = lookup(ref);
    if (intent instanceof PDFDict) f.outputIntents.push({ s: name(intent.get(N('S'))) ?? '', profile: lookup(intent.get(N('DestOutputProfile'))) instanceof PDFStream });
  }
  const metadata = lookup(catalog.get(N('Metadata')));
  if (metadata instanceof PDFStream) { try { f.xmp = new TextDecoder('utf-8').decode(decodedStream(metadata)); } catch { f.xmp = ''; } }
  const form = lookup(catalog.get(N('AcroForm'))) as PDFDict | undefined;
  f.needAppearances = lookup(form?.get(N('NeedAppearances'))) === PDFBool.True;
  if (form?.has(N('XFA'))) f.scripts.push('XFA form');
  f.optionalContent = catalog.has(N('OCProperties'));
  const markInfo = lookup(catalog.get(N('MarkInfo'))) as PDFDict | undefined;
  f.marked = lookup(markInfo?.get(N('Marked'))) === PDFBool.True;
  f.structTree = lookup(catalog.get(N('StructTreeRoot'))) as PDFDict | undefined;
  f.lang = text(lookup(catalog.get(N('Lang'))));
  const prefs = lookup(catalog.get(N('ViewerPreferences'))) as PDFDict | undefined;
  f.displayTitle = lookup(prefs?.get(N('DisplayDocTitle'))) === PDFBool.True;
  f.title = /<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)</.exec(f.xmp ?? '')?.[1]?.trim() || text(f.info?.get(N('Title')));
  // Figures and their alternate text.
  const roleMap = lookup(f.structTree?.get(N('RoleMap'))) as PDFDict | undefined;
  const seen = new Set<PDFObject>();
  const visit = (o: PDFObject | undefined, depth: number) => {
    const node = lookup(o);
    if (!node || seen.has(node) || depth > 128 || seen.size > MAX_WALK) return;
    seen.add(node);
    if (node instanceof PDFArray) { node.asArray().forEach((k) => visit(k, depth + 1)); return; }
    if (!(node instanceof PDFDict)) return;
    const role = name(node.get(N('S')));
    const mapped = role && roleMap ? name(lookup(roleMap.get(N(role)))) ?? role : role;
    if (mapped === 'Figure') { f.figures++; if (!text(lookup(node.get(N('Alt')))) && !text(lookup(node.get(N('ActualText'))))) f.figuresWithoutAlt++; }
    visit(node.get(N('K')), depth + 1);
  };
  visit(f.structTree?.get(N('K')), 0);
  return f;
}

const list = (items: Iterable<string>, max = 12) => { const all = [...items]; return all.length > max ? [...all.slice(0, max), `…and ${all.length - max} more`] : all; };

function checksFor(profile: PreflightProfile, f: Facts): PreflightCheck[] {
  const pdfa = profile.startsWith('pdfa'); const pdfx = profile.startsWith('pdfx'); const ua = profile === 'pdfua-1';
  const part = Number(profile.split('-')[1][0]);
  const out: PreflightCheck[] = [];
  const add = (id: string, group: CheckGroup, label: string, failures: string[]) => out.push({ id, group, label, passed: failures.length === 0, details: list(failures) });
  const xmp = f.xmp ?? '';
  // Structure.
  add('not-encrypted', 'Structure', 'The file is not encrypted', f.encrypted && (pdfa || pdfx) ? ['The document is encrypted.'] : []);
  if (pdfa) {
    add('version', 'Structure', `PDF version is at most ${part === 1 ? '1.4' : '1.7'}`, f.version > (part === 1 ? 1.4 : 1.7) ? [`The file says PDF ${f.version}.`] : []);
    add('binary-header', 'Structure', 'The header is followed by a binary comment', f.binaryHeader ? [] : ['The second line is not a comment of four bytes above 127.']);
    add('file-id', 'Structure', 'The trailer has a file identifier', f.hasId ? [] : ['The trailer has no ID.']);
    add('no-lzw', 'Structure', 'No LZW compression', f.lzw);
  }
  // Fonts.
  const unembedded = [...f.fonts].filter(([, v]) => !v.embedded).map(([k, v]) => `${k} (${v.where})`);
  if (pdfa || pdfx || ua) add('fonts-embedded', 'Fonts', 'Every font is embedded', unembedded);
  // Colour.
  const device = (space: string) => [...(f.spaces.get(space) ?? [])].map((w) => `${space}: ${w}`);
  const intent = (s: string) => f.outputIntents.find((o) => o.s === s);
  if (pdfa) {
    const pdfaIntent = intent('GTS_PDFA1');
    add('output-intent', 'Colour', 'A PDF/A output intent with an ICC profile, or no device colour', !pdfaIntent?.profile && (f.spaces.has('DeviceRGB') || f.spaces.has('DeviceCMYK')) ? ['Device colour is used without a GTS_PDFA1 output intent and profile.'] : []);
    if (pdfaIntent?.profile) add('device-colour-matches', 'Colour', 'Device colour matches the output intent family', f.spaces.has('DeviceRGB') && f.spaces.has('DeviceCMYK') ? ['Both DeviceRGB and DeviceCMYK are used; only one can match the output intent.', ...device('DeviceRGB').slice(0, 3), ...device('DeviceCMYK').slice(0, 3)] : []);
  }
  if (pdfx) {
    add('output-intent', 'Colour', 'A PDF/X output intent (GTS_PDFX)', intent('GTS_PDFX') ? [] : ['No GTS_PDFX output intent.']);
    if (profile === 'pdfx-1a') add('cmyk-only', 'Colour', 'Only CMYK, grey and spot colour (no RGB or calibrated colour)', [...device('DeviceRGB'), ...(f.iccOrLab ? [`${f.iccOrLab} ICC-based, Lab or calibrated colour space(s)`] : [])]);
  }
  // Transparency.
  if (profile === 'pdfa-1b' || profile === 'pdfx-1a') add('no-transparency', 'Transparency', 'No transparency (soft masks, opacity, blend modes, transparency groups)', f.transparency);
  // Metadata.
  if (pdfa) {
    const id = /pdfaid:part(?:>|=["'])\s*(\d)/.exec(xmp)?.[1];
    add('xmp', 'Metadata', 'XMP metadata is present', f.xmp === null ? ['The catalog has no XMP metadata stream.'] : []);
    add('pdfa-id', 'Metadata', `XMP identifies the file as PDF/A-${part}`, id === String(part) ? [] : [id ? `XMP says PDF/A-${id}.` : 'The XMP has no pdfaid:part.']);
  }
  if (pdfx) {
    const trapped = name(f.info?.get(N('Trapped')));
    add('trapped', 'Metadata', 'Trapped is set to True or False', trapped === 'True' || trapped === 'False' ? [] : ['The document information has no Trapped key set to True or False.']);
    add('pdfx-version', 'Metadata', 'The PDF/X version is identified', /GTS_PDFXVersion|pdfxid:GTS_PDFXVersion/.test(xmp) || text(f.info?.get(N('GTS_PDFXVersion'))) ? [] : ['No GTS_PDFXVersion in the document information or XMP.']);
  }
  if (ua) {
    add('title', 'Metadata', 'The document has a title, shown in the window title', [...(f.title ? [] : ['No title in the XMP metadata.']), ...(f.displayTitle ? [] : ['DisplayDocTitle is not set in the viewer preferences.'])]);
    add('pdfua-id', 'Metadata', 'XMP identifies the file as PDF/UA-1', /pdfuaid:part(?:>|=["'])\s*1/.test(xmp) ? [] : ['The XMP has no pdfuaid:part 1.']);
    add('language', 'Metadata', 'The document language is set', f.lang ? [] : ['The catalog has no Lang entry.']);
  }
  // Actions and content.
  if (pdfa || pdfx) add('no-scripts', 'Actions and content', 'No JavaScript, launch or multimedia actions, and no XFA', f.scripts);
  if (pdfa) {
    const bad = part === 3 ? f.attachments.filter((a) => !a.relationship).map((a) => `${a.name}: no AFRelationship`) : part === 2 ? f.attachments.map((a) => `${a.name} (only PDF/A files may be embedded; MALENJO cannot confirm this one is)`) : f.attachments.map((a) => a.name);
    add('attachments', 'Actions and content', part === 3 ? 'Attached files declare their relationship' : 'No embedded files', bad);
    if (part === 1) add('no-optional-content', 'Actions and content', 'No optional content (layers)', f.optionalContent ? ['The document has layers (OCProperties).'] : []);
  }
  // Annotations and forms.
  if (pdfa || pdfx) {
    const forbidden = new Set(['Sound', 'Movie', 'Screen', 'RichMedia', ...(part === 1 ? ['FileAttachment', '3D'] : [])]);
    add('annotation-types', 'Annotations and forms', 'Only permitted annotation types', f.annotations.filter((a) => forbidden.has(a.subtype)).map((a) => `Page ${a.page}: ${a.subtype}`));
    add('annotation-appearance', 'Annotations and forms', 'Annotations have appearances and are set to print', f.annotations.filter((a) => !['Popup', 'Link'].includes(a.subtype) && (!a.hasAppearance || !a.printFlag || a.hidden))
      .map((a) => `Page ${a.page}: ${a.subtype} ${!a.hasAppearance ? 'has no appearance' : a.hidden ? 'is hidden' : 'is not set to print'}`));
    add('need-appearances', 'Annotations and forms', 'Form fields do not rely on the viewer to draw them', f.needAppearances ? ['NeedAppearances is true.'] : []);
  }
  // Tagging.
  if (ua) {
    add('tagged', 'Tagging', 'The document is tagged', [...(f.marked ? [] : ['MarkInfo Marked is not true.']), ...(f.structTree ? [] : ['There is no structure tree.'])]);
    add('figure-alt', 'Tagging', 'Every figure has alternate text', f.figuresWithoutAlt ? [`${f.figuresWithoutAlt} of ${f.figures} figure(s) have no Alt or ActualText.`] : []);
    add('tab-order', 'Tagging', 'Pages with annotations use structure tab order', f.pages.map((p, i) => (p.annots && p.tabs !== 'S' ? `Page ${i + 1}` : '')).filter(Boolean));
  }
  // Page boxes.
  if (pdfx) {
    add('trim-box', 'Page boxes', 'Every page has a TrimBox or ArtBox', f.pages.map((p, i) => (!p.trim && !p.art ? `Page ${i + 1}` : '')).filter(Boolean));
    add('box-nesting', 'Page boxes', 'Trim and bleed boxes lie within the media box', f.pages.map((p, i) => (!p.bleedInside ? `Page ${i + 1}` : '')).filter(Boolean));
  }
  return out;
}

export async function preflightPdf(bytes: Uint8Array, profiles: PreflightProfile[]): Promise<PreflightResult[]> {
  if (!profiles.length) throw new Error('Choose at least one profile to check against.');
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > 256 * 1024 * 1024) throw new Error('Preflight handles PDFs up to 256 MB.');
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true }); } catch { throw new Error('This PDF could not be read because it is invalid or damaged, which fails every profile.'); }
  const facts = gather(pdf, bytes);
  return profiles.map((profile) => {
    const checks = checksFor(profile, facts);
    return { profile, name: PREFLIGHT_PROFILES.find(([p]) => p === profile)?.[1] ?? profile, passed: checks.every((c) => c.passed), checks };
  });
}

/** A plain-text report (also used for the saved .txt). */
export function preflightReportText(results: PreflightResult[], fileName: string, when = new Date()): string {
  const lines = [`MALENJO preflight report for ${fileName}`, `Checked ${when.toISOString()}. MALENJO checks the conditions listed; it is not a certified validator.`, ''];
  for (const r of results) {
    lines.push(`${r.name}: ${r.passed ? 'PASSED' : 'FAILED'} (${r.checks.filter((c) => !c.passed).length} of ${r.checks.length} checks failed)`);
    for (const c of r.checks) { lines.push(`  [${c.passed ? 'pass' : 'FAIL'}] ${c.group} — ${c.label}`); for (const d of c.details) lines.push(`         ${d}`); }
    lines.push('');
  }
  return lines.join('\n');
}
