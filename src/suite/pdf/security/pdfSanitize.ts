/**
 * Metadata and hidden-content sanitization (MAL-070): inspects a PDF for potentially sensitive resources, by category,
 * and removes the categories the user selects.
 *
 * - metadata: the document information dictionary, XMP streams, private application data (PieceInfo, LastModified).
 * - attachments: embedded files, file-attachment annotations, associated files, portfolio collections.
 * - scripts: document JavaScript, open and additional actions (AA), and JavaScript, Launch, SubmitForm, ImportData
 *   and rich-media actions anywhere (form calculation and validation scripts are AA too, so they go with them).
 * - links: links to web addresses and to other files.
 * - hidden: annotations hidden from view, content in layers that are off by default, and invisible text (for example
 *   an OCR layer). Content is removed only where that cannot move what stays visible; anything else is reported.
 * - other: page thumbnails and XFA form data.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { removeUnreachableObjects } from './pdfGarbage';
import { rewriteContent, tokenizeContent, type ContentOp } from '../content/contentLexer';
import { pageContentBytes, readPageModel } from '../content/contentModel';

export type SanitizeCategory = 'metadata' | 'attachments' | 'scripts' | 'links' | 'hidden' | 'other';
export const SANITIZE_CATEGORIES: [SanitizeCategory, string][] = [
  ['metadata', 'Metadata'], ['attachments', 'Attachments'], ['scripts', 'Scripts and actions'], ['links', 'Links to web addresses and files'],
  ['hidden', 'Hidden content'], ['other', 'Thumbnails and XFA data'],
];
export interface SanitizeFinding { category: SanitizeCategory; items: string[] }
export interface SanitizeResult { bytes: Uint8Array; removed: SanitizeFinding[]; kept: string[] }

const N = PDFName.of;
const RISKY_ACTIONS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'RichMediaExecute']);
const EXTERNAL_ACTIONS = new Set(['URI', 'GoToR', 'GoToE']);
const MAX_INPUT = 200 * 1024 * 1024;

const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : '');
const actionType = (pdf: PDFDocument, action: PDFObject | undefined) => { const a = action ? pdf.context.lookup(action) : undefined; return a instanceof PDFDict ? text(a.get(N('S'))) : ''; };

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (bytes.length > MAX_INPUT) throw new Error('Sanitize handles files up to 200 MB.');
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); } catch (error) {
    if (/encrypt/i.test(String(error))) throw new Error('This PDF is protected. Remove its protection first, then sanitize it.');
    throw new Error('This PDF could not be read because it is invalid or damaged.');
  }
}

/** Every annotation dictionary on every page, with its page and position in the page's /Annots. */
function annotations(pdf: PDFDocument) {
  const out: { page: number; annots: PDFArray; index: number; dict: PDFDict }[] = [];
  pdf.getPages().forEach((page, p) => {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
    annots?.asArray().forEach((ref, index) => { const dict = pdf.context.lookup(ref); if (dict instanceof PDFDict) out.push({ page: p + 1, annots, index, dict }); });
  });
  return out;
}

/** Optional content groups that are off when the document opens. */
function offGroups(pdf: PDFDocument): Set<string> {
  const props = pdf.catalog.lookupMaybe(N('OCProperties'), PDFDict);
  const d = props?.lookupMaybe(N('D'), PDFDict);
  const refs = (key: string) => (d?.lookupMaybe(N(key), PDFArray)?.asArray() ?? []).map(String);
  const all = (props?.lookupMaybe(N('OCGs'), PDFArray)?.asArray() ?? []).map(String);
  const off = d?.lookupMaybe(N('BaseState'), PDFName) === N('OFF') ? all.filter((r) => !refs('ON').includes(r)) : refs('OFF');
  return new Set(off);
}

/** Page-content removals for hidden content: blocks in off layers, and text objects drawn only invisibly. */
function hiddenContent(pdf: PDFDocument, pageIndex: number, off: Set<string>) {
  const ops = tokenizeContent(pageContentBytes(pdf, pageIndex));
  const props = pdf.getPage(pageIndex).node.Resources()?.lookupMaybe(N('Properties'), PDFDict);
  const remove = new Set<number>(); let kept = 0, layerBlocks = 0, invisibleBlocks = 0;
  // A range can go only if its graphics states and text objects are balanced: removing it moves nothing else.
  const balanced = (a: number, b: number) => { let q = 0, bt = 0; for (let i = a; i <= b; i++) { const o = ops[i].op; if (o === 'q') q++; else if (o === 'Q' && --q < 0) return false; else if (o === 'BT') bt++; else if (o === 'ET' && --bt < 0) return false; } return q === 0 && bt === 0; };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.op !== 'BDC' || op.operands[0]?.type !== 'name' || op.operands[0].value !== 'OC' || op.operands[1]?.type !== 'name') continue;
    const ref = props?.get(N(op.operands[1].value));
    if (!(ref instanceof PDFRef) || !off.has(String(ref))) continue;
    let depth = 0, end = -1;
    for (let j = i; j < ops.length; j++) { if (ops[j].op === 'BDC' || ops[j].op === 'BMC') depth++; else if (ops[j].op === 'EMC' && --depth === 0) { end = j; break; } }
    if (end < 0 || !balanced(i, end)) { kept++; continue; }
    for (let j = i; j <= end; j++) remove.add(j);
    layerBlocks++; i = end;
  }
  const model = readPageModel(pdf, pageIndex);
  const byBlock = new Map<number, boolean[]>();
  for (const run of model.runs) { const list = byBlock.get(run.btIndex) ?? []; list.push(run.render % 4 === 3); byBlock.set(run.btIndex, list); }
  for (const [bt, flags] of byBlock) {
    if (remove.has(bt)) continue;
    const et = ops.findIndex((o, k) => k > bt && o.op === 'ET');
    if (flags.every(Boolean) && et > 0) { for (let j = bt; j <= et; j++) remove.add(j); invisibleBlocks++; }
    else if (flags.some(Boolean)) kept++;
  }
  return { ops, remove, kept, layerBlocks, invisibleBlocks };
}

function writePageContent(pdf: PDFDocument, pageIndex: number, ops: ContentOp[], remove: Set<number>) {
  const data = rewriteContent(pageContentBytes(pdf, pageIndex), ops, new Map([...remove].map((i) => [i, ''])));
  const node = pdf.getPage(pageIndex).node;
  node.set(N('Contents'), pdf.context.register(pdf.context.flateStream(data)));
}

/** Findings by category, without changing the file. */
export async function inspectPdfSanitization(bytes: Uint8Array): Promise<SanitizeFinding[]> {
  return (await scan(await load(bytes), new Set(), false)).removed;
}

/** Removes the selected categories and reports what was removed and what had to stay. */
export async function sanitizePdf(bytes: Uint8Array, categories: SanitizeCategory[]): Promise<SanitizeResult> {
  if (!categories.length) throw new Error('Choose at least one kind of content to remove.');
  const pdf = await load(bytes);
  if (pdf.getForm().getFields().some((f) => f.acroField.dict.lookup(N('FT')) === N('Sig') && f.acroField.dict.has(N('V')))) {
    throw new Error('This PDF is digitally signed; removing content would invalidate the signatures. Sanitize an unsigned copy instead.');
  }
  const result = await scan(pdf, new Set(categories), true);
  removeUnreachableObjects(pdf);
  return { bytes: await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }), removed: result.removed.filter((f) => categories.includes(f.category)), kept: result.kept };
}

async function scan(pdf: PDFDocument, selected: Set<SanitizeCategory>, apply: boolean) {
  const found: Record<SanitizeCategory, string[]> = { metadata: [], attachments: [], scripts: [], links: [], hidden: [], other: [] };
  const kept: string[] = [];
  const doing = (c: SanitizeCategory) => apply && selected.has(c);
  const catalog = pdf.catalog;

  // Metadata.
  const infoRef = pdf.context.trailerInfo.Info;
  const info = infoRef ? pdf.context.lookup(infoRef) : undefined;
  if (info instanceof PDFDict) for (const [key, value] of info.entries()) found.metadata.push(`Document information: ${key.decodeText()}${text(value) ? ` (“${text(value).slice(0, 60)}”)` : ''}`);
  if (catalog.has(N('Metadata'))) found.metadata.push('XMP metadata stream');
  const privateData = (dict: PDFDict, where: string) => { for (const key of ['PieceInfo', 'LastModified']) if (dict.has(N(key))) { found.metadata.push(`${where}: ${key}`); if (doing('metadata')) dict.delete(N(key)); } };
  privateData(catalog, 'Document');
  pdf.getPages().forEach((page, i) => {
    privateData(page.node, `Page ${i + 1}`);
    if (page.node.has(N('Metadata'))) { found.metadata.push(`Page ${i + 1}: XMP metadata`); if (doing('metadata')) page.node.delete(N('Metadata')); }
    if (page.node.has(N('Thumb'))) { found.other.push(`Page ${i + 1}: thumbnail image`); if (doing('other')) page.node.delete(N('Thumb')); }
  });
  if (doing('metadata')) {
    if (infoRef instanceof PDFRef) pdf.context.delete(infoRef);
    delete (pdf.context.trailerInfo as { Info?: unknown }).Info;
    catalog.delete(N('Metadata'));
  }

  // Attachments and document-level scripts.
  const names = catalog.lookupMaybe(N('Names'), PDFDict);
  const nameTree = (key: string) => {
    const out: string[] = [];
    const walk = (node: PDFDict | undefined, depth: number) => {
      if (!node || depth > 32) return;
      const pairs = node.lookupMaybe(N('Names'), PDFArray)?.asArray() ?? [];
      for (let i = 0; i < pairs.length; i += 2) out.push(text(pdf.context.lookup(pairs[i])) || 'unnamed');
      for (const kid of node.lookupMaybe(N('Kids'), PDFArray)?.asArray() ?? []) walk(pdf.context.lookup(kid) as PDFDict, depth + 1);
    };
    walk(names?.lookupMaybe(N(key), PDFDict), 0);
    return out;
  };
  for (const file of nameTree('EmbeddedFiles')) found.attachments.push(`Embedded file “${file}”`);
  if (catalog.has(N('AF'))) found.attachments.push('Associated files on the document');
  if (catalog.has(N('Collection'))) found.attachments.push('Portfolio (collection) settings');
  if (doing('attachments')) { names?.delete(N('EmbeddedFiles')); catalog.delete(N('AF')); catalog.delete(N('Collection')); }
  for (const script of nameTree('JavaScript')) found.scripts.push(`Document JavaScript “${script}”`);
  if (doing('scripts')) names?.delete(N('JavaScript'));
  const open = actionType(pdf, catalog.get(N('OpenAction')));
  if (open && (RISKY_ACTIONS.has(open) || EXTERNAL_ACTIONS.has(open))) { found.scripts.push(`Open action (${open})`); if (doing('scripts')) catalog.delete(N('OpenAction')); }
  const additional = (dict: PDFDict, where: string) => { if (dict.has(N('AA'))) { found.scripts.push(`${where}: additional actions`); if (doing('scripts')) dict.delete(N('AA')); } };
  additional(catalog, 'Document');
  pdf.getPages().forEach((page, i) => additional(page.node, `Page ${i + 1}`));
  for (const field of pdf.getForm().getFields()) additional(field.acroField.dict, `Field “${field.getName()}”`);
  const acroForm = catalog.lookupMaybe(N('AcroForm'), PDFDict);
  if (acroForm?.has(N('XFA'))) { found.other.push('XFA form data'); if (doing('other')) acroForm.delete(N('XFA')); }

  // Annotations: attachments, actions, links and hidden ones. Removals are collected, then applied per page.
  const drop = new Map<PDFArray, Set<number>>();
  const dropAnnot = (annots: PDFArray, index: number) => { const set = drop.get(annots) ?? new Set<number>(); set.add(index); drop.set(annots, set); };
  const off = offGroups(pdf);
  for (const { page, annots, index, dict } of annotations(pdf)) {
    const subtype = text(dict.get(N('Subtype')));
    const where = `Page ${page}: ${subtype || 'annotation'}`;
    if (subtype === 'FileAttachment') { found.attachments.push(`${where} “${text(dict.lookup(N('Contents'))) || 'attachment'}”`); if (doing('attachments')) { dropAnnot(annots, index); continue; } }
    if (dict.has(N('AF'))) { found.attachments.push(`${where}: associated files`); if (doing('attachments')) dict.delete(N('AF')); }
    const action = actionType(pdf, dict.get(N('A')));
    if (RISKY_ACTIONS.has(action)) { found.scripts.push(`${where}: ${action} action`); if (doing('scripts')) dict.delete(N('A')); }
    else if (EXTERNAL_ACTIONS.has(action)) {
      const a = pdf.context.lookup(dict.get(N('A'))!) as PDFDict;
      found.links.push(`${where} to ${text(a.lookup(N('URI'))) || text(a.lookup(N('F'))) || 'another file'}`);
      if (doing('links')) { if (subtype === 'Link') { dropAnnot(annots, index); continue; } dict.delete(N('A')); }
    }
    additional(dict, where);
    const flags = dict.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0;
    const oc = dict.get(N('OC'));
    if ((flags & 2) || (flags & 32) || (oc instanceof PDFRef && off.has(String(oc)))) { found.hidden.push(`${where} hidden from view`); if (doing('hidden')) dropAnnot(annots, index); }
  }
  for (const [annots, indexes] of drop) [...indexes].sort((a, b) => b - a).forEach((i) => annots.remove(i));

  // Hidden page content.
  for (let p = 0; p < pdf.getPageCount(); p++) {
    let analysis: ReturnType<typeof hiddenContent>;
    try { analysis = hiddenContent(pdf, p, off); } catch { kept.push(`Page ${p + 1}: content that could not be read was left unchanged.`); continue; }
    if (analysis.layerBlocks) found.hidden.push(`Page ${p + 1}: ${analysis.layerBlocks} block(s) in layers that are off`);
    if (analysis.invisibleBlocks) found.hidden.push(`Page ${p + 1}: ${analysis.invisibleBlocks} invisible text object(s)`);
    if (analysis.kept) kept.push(`Page ${p + 1}: ${analysis.kept} hidden item(s) mixed with visible content were kept, since removing them would move visible content.`);
    if (doing('hidden') && analysis.remove.size) writePageContent(pdf, p, analysis.ops, analysis.remove);
  }
  if (doing('hidden') && off.size) kept.push('Layers that are off may still be used by embedded drawings; their definitions were kept.');

  const removed = (Object.keys(found) as SanitizeCategory[]).filter((c) => found[c].length).map((category) => ({ category, items: found[category] }));
  return { removed, kept };
}

