/**
 * Before pages are removed, drop the navigation that would point at them:
 * link annotations on the remaining pages whose destination is a removed page,
 * and bookmarks whose destination is a removed page (their children move up
 * into their place, so bookmarks to kept pages survive).
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import { resolveDestination } from './pdfMerge';

const N = (name: string) => PDFName.of(name);

function target(pdf: PDFDocument, dict: PDFDict): string | null {
  const action = dict.get(N('A')) ? pdf.context.lookup(dict.get(N('A'))) : undefined;
  const value = dict.get(N('Dest')) ?? (action instanceof PDFDict && action.get(N('S'))?.toString() === '/GoTo' ? action : undefined);
  const first = resolveDestination(pdf, value)?.get(0);
  return first instanceof PDFRef ? first.toString() : null;
}

export function pruneNavigationToPages(pdf: PDFDocument, removed: Set<string>): { links: number; bookmarks: number } {
  let links = 0, bookmarks = 0;
  for (const page of pdf.getPages()) {
    if (removed.has(page.ref.toString())) continue;
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
    for (let i = (annots?.size() ?? 0) - 1; i >= 0; i--) {
      const dict = pdf.context.lookup(annots!.get(i));
      if (dict instanceof PDFDict && dict.get(N('Subtype'))?.toString() === '/Link') {
        const to = target(pdf, dict);
        if (to && removed.has(to)) { annots!.remove(i); links++; }
      }
    }
  }
  const rootRef = pdf.catalog.get(N('Outlines'));
  const root = rootRef ? pdf.context.lookup(rootRef) : undefined;
  if (!(root instanceof PDFDict) || !(rootRef instanceof PDFRef)) return { links, bookmarks };
  const seen = new Set<string>();
  const children = (parent: PDFDict): PDFRef[] => {
    const out: PDFRef[] = [];
    for (let ref = parent.get(N('First')); ref instanceof PDFRef && !seen.has(ref.toString()) && seen.size < 10000;) {
      seen.add(ref.toString()); out.push(ref);
      ref = (pdf.context.lookup(ref) as PDFDict).get(N('Next'));
    }
    return out;
  };
  /** Rebuilds a parent's child list, dropping bookmarks to removed pages; returns the visible count. */
  const rebuild = (parent: PDFDict, parentRef: PDFRef): number => {
    // A bookmark to a removed page is dropped and its children take its place (checked the same way).
    const keepFrom = (refs: PDFRef[]): PDFRef[] => refs.flatMap((ref) => {
      const dict = pdf.context.lookup(ref, PDFDict);
      const to = target(pdf, dict);
      if (!to || !removed.has(to)) return [ref];
      bookmarks++;
      return keepFrom(children(dict));
    });
    const kept = keepFrom(children(parent));
    let visible = 0;
    kept.forEach((ref, i) => {
      const dict = pdf.context.lookup(ref, PDFDict);
      dict.set(N('Parent'), parentRef);
      if (i) dict.set(N('Prev'), kept[i - 1]); else dict.delete(N('Prev'));
      if (i < kept.length - 1) dict.set(N('Next'), kept[i + 1]); else dict.delete(N('Next'));
    });
    for (const ref of kept) {
      const dict = pdf.context.lookup(ref, PDFDict);
      const inner = rebuild(dict, ref);
      if (inner) { const open = (dict.lookupMaybe(N('Count'), PDFNumber)?.asNumber() ?? 1) >= 0; dict.set(N('Count'), PDFNumber.of(open ? inner : -inner)); visible += open ? inner : 0; }
      else dict.delete(N('Count'));
      visible++;
    }
    if (kept.length) { parent.set(N('First'), kept[0]); parent.set(N('Last'), kept[kept.length - 1]); }
    else { parent.delete(N('First')); parent.delete(N('Last')); }
    return visible;
  };
  const total = rebuild(root, rootRef);
  root.set(N('Count'), PDFNumber.of(total));
  return { links, bookmarks };
}
