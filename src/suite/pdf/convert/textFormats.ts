/* PDF to Markdown (MAL-041), HTML (MAL-042) and plain text (MAL-044). */
import { encodePng } from './imageCodecs';
import { blocksOf, documentHeadingSizes, pageText, type Block, type PageStructure, type ReadingOrder } from './pdfStructure';

export interface ConversionFile { name: string; bytes: Uint8Array; mime: string }
export interface ConversionResult { files: ConversionFile[]; notes: string[] }
export type PageSeparator = 'none' | 'blank' | 'formfeed' | 'custom';

const enc = (text: string) => new TextEncoder().encode(text);
const imageName = (page: number, index: number) => `assets/page-${page}-image-${index + 1}.png`;
function commonNotes(pages: PageStructure[], images: boolean): string[] {
  const notes = ['Headings, lists and tables are rebuilt from the page layout; check them before relying on the structure.'];
  const empty = pages.filter((p) => !p.items.some((i) => i.str.trim())).map((p) => p.pageNumber);
  if (empty.length) notes.push(`No text on page${empty.length > 1 ? 's' : ''} ${empty.join(', ')}: scanned pages need OCR first.`);
  const skipped = pages.reduce((n, p) => n + p.skippedImages, 0);
  if (images && skipped) notes.push(`${skipped} image(s) or image masks in unsupported formats were left out.`);
  return notes;
}
function imageFiles(pages: PageStructure[]): ConversionFile[] {
  return pages.flatMap((p) => p.images.map((img, i) => ({ name: imageName(p.pageNumber, i), bytes: encodePng(img.image), mime: 'image/png' })));
}

// ---- Markdown ---------------------------------------------------------------------------------

const mdInline = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1');
const mdLine = (text: string) => mdInline(text).replace(/^(#{1,6}\s|>|[-+*]\s|\d+[.)]\s)/, '\\$1');
function mdBlock(block: Block, page: number): string {
  switch (block.kind) {
    case 'heading': return `${'#'.repeat(block.level)} ${mdInline(block.text)}`;
    case 'paragraph': { const t = mdLine(block.text); return block.bold ? `**${t}**` : block.italic ? `*${t}*` : t; }
    case 'list': return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${mdInline(item)}`).join('\n');
    case 'table': {
      const cell = (c: string) => mdInline(c).replace(/\|/g, '\\|');
      const [head, ...rest] = block.rows;
      return [`| ${head.map(cell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rest.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
    }
    case 'image': return `![Page ${page} image ${block.index + 1}](${imageName(page, block.index)})`;
  }
}
export function pdfToMarkdown(pages: PageStructure[], options: { images: boolean; title: string }): ConversionResult {
  const sizes = documentHeadingSizes(pages);
  const body = pages.map((p) => [`<!-- Page ${p.pageNumber} -->`, ...blocksOf(options.images ? p : { ...p, images: [] }, sizes).map((b) => mdBlock(b, p.pageNumber))].join('\n\n')).join('\n\n');
  const files: ConversionFile[] = [{ name: `${options.title}.md`, bytes: enc(body.trim() + '\n'), mime: 'text/markdown' }];
  if (options.images) files.push(...imageFiles(pages));
  return { files, notes: commonNotes(pages, options.images) };
}

// ---- HTML -------------------------------------------------------------------------------------

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function htmlBlock(block: Block, page: number): string {
  switch (block.kind) {
    case 'heading': return `<h${block.level}>${esc(block.text)}</h${block.level}>`;
    case 'paragraph': { const t = esc(block.text); return `<p>${block.bold ? `<strong>${t}</strong>` : block.italic ? `<em>${t}</em>` : t}</p>`; }
    case 'list': { const tag = block.ordered ? 'ol' : 'ul'; return `<${tag}>${block.items.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`; }
    case 'table': {
      const [head, ...rest] = block.rows;
      return `<table><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    case 'image': return `<figure><img src="${imageName(page, block.index)}" alt="Page ${page} image ${block.index + 1}"></figure>`;
  }
}
const r1 = (n: number) => Math.round(n * 10) / 10;
function positionedPage(p: PageStructure, images: boolean): string {
  const spans = p.items.filter((i) => i.str.trim()).map((i) => `<span style="left:${r1(i.x)}pt;top:${r1(i.y - i.size * 0.8)}pt;font-size:${r1(i.size)}pt${i.bold ? ';font-weight:bold' : ''}${i.italic ? ';font-style:italic' : ''}">${esc(i.str)}</span>`);
  const imgs = images ? p.images.map((img, k) => `<img src="${imageName(p.pageNumber, k)}" alt="Page ${p.pageNumber} image ${k + 1}" style="left:${r1(img.x)}pt;top:${r1(img.y)}pt;width:${r1(img.width)}pt;height:${r1(img.height)}pt">`) : [];
  return `<section class="page" id="page-${p.pageNumber}" style="width:${r1(p.width)}pt;height:${r1(p.height)}pt">\n${[...imgs, ...spans].join('\n')}\n</section>`;
}
export function pdfToHtml(pages: PageStructure[], options: { images: boolean; title: string; layout: 'semantic' | 'positioned' }): ConversionResult {
  const sizes = documentHeadingSizes(pages);
  const style = options.layout === 'positioned'
    ? 'body{background:#eee;margin:0;padding:16px;font-family:Helvetica,Arial,sans-serif}.page{position:relative;background:#fff;margin:0 auto 16px;overflow:hidden}.page span{position:absolute;white-space:pre;line-height:1}.page img{position:absolute}'
    : 'body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.5}table{border-collapse:collapse}th,td{border:1px solid #999;padding:.25rem .5rem}img{max-width:100%}';
  const content = options.layout === 'positioned'
    ? pages.map((p) => positionedPage(p, options.images)).join('\n')
    : pages.map((p) => `<section class="page" id="page-${p.pageNumber}">\n${blocksOf(options.images ? p : { ...p, images: [] }, sizes).map((b) => htmlBlock(b, p.pageNumber)).join('\n')}\n</section>`).join('\n');
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(options.title)}</title>\n<style>${style}</style>\n</head>\n<body>\n<main>\n${content}\n</main>\n</body>\n</html>\n`;
  const files: ConversionFile[] = [{ name: `${options.title}.html`, bytes: enc(html), mime: 'text/html' }];
  if (options.images) files.push(...imageFiles(pages));
  const notes = commonNotes(pages, options.images);
  if (options.layout === 'positioned') notes[0] = 'Text is placed where it appears on each page; fonts are approximated with standard fonts.';
  return { files, notes };
}

// ---- Plain text -------------------------------------------------------------------------------

export function pdfToPlainText(pages: PageStructure[], total: number, options: { order: ReadingOrder; separator: PageSeparator; template: string; title: string }): ConversionResult {
  const sep = (n: number) => options.separator === 'none' ? '\n' : options.separator === 'blank' ? '\n\n' : options.separator === 'formfeed' ? '\n\f\n'
    : `\n${options.template.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total))}\n`;
  let text = '';
  pages.forEach((p, i) => { if (i > 0 || options.separator === 'custom') text += i === 0 ? sep(p.pageNumber).slice(1) : sep(p.pageNumber); text += pageText(p, options.order); });
  const notes: string[] = [];
  const empty = pages.filter((p) => !p.items.some((i) => i.str.trim())).map((p) => p.pageNumber);
  if (empty.length) notes.push(`No text on page${empty.length > 1 ? 's' : ''} ${empty.join(', ')}: scanned pages need OCR first.`);
  if (!text.trim()) throw new Error('These pages have no text to export. Run OCR on scanned pages first.');
  return { files: [{ name: `${options.title}.txt`, bytes: enc(text.trimEnd() + '\n'), mime: 'text/plain' }], notes };
}
