/**
 * pdf-lib writes every object it holds, referenced or not. After removing content (sanitizing, redacting), the
 * objects nothing points to any more would still be written into the file, so they are deleted here first.
 */
import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from 'pdf-lib';

/** Deletes every indirect object that cannot be reached from the trailer; returns how many were deleted. */
export function removeUnreachableObjects(pdf: PDFDocument): number {
  const context = pdf.context;
  const reached = new Set<string>();
  const pending: PDFObject[] = [];
  const info = context.trailerInfo;
  for (const root of [info.Root, info.Info, info.Encrypt, info.ID]) if (root) pending.push(root as PDFObject);
  while (pending.length) {
    const object = pending.pop()!;
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (reached.has(key)) continue;
      reached.add(key);
      const target = context.lookup(object);
      if (target) pending.push(target);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) pending.push(value);
    } else if (object instanceof PDFArray) {
      for (let i = 0; i < object.size(); i++) pending.push(object.get(i));
    } else if (object instanceof PDFStream) {
      pending.push(object.dict);
    }
  }
  let deleted = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) { context.delete(ref); deleted++; }
  }
  return deleted;
}
