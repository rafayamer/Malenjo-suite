import { disposePdf, loadPdfBytes } from '../pdf/engine';
import { parseOffice } from '../office/ooxml';
import type { SourceDocument } from './rag';

const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024;

function sourceId(name: string): string {
  return `source-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const loaded = await loadPdfBytes(bytes);
  try {
    const pages: string[] = [];
    const count = Math.min(loaded.document.numPages, 500);
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      const page = await loaded.document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => 'str' in item ? String(item.str) : '')
        .filter(Boolean)
        .join(' ');
      pages.push(`Page ${pageNumber}\n${text}`);
    }
    return pages.join('\n\n');
  } finally {
    await disposePdf(loaded);
  }
}

function officeText(bytes: Uint8Array): string {
  const model = parseOffice(bytes);
  if (model.kind === 'docx') return model.paragraphs.join('\n\n');
  if (model.kind === 'xlsx') {
    return model.cells.map((row, index) => `Row ${index + 1}: ${row.join('\t')}`).join('\n');
  }
  return model.slides.map((slide, index) => `Slide ${index + 1}: ${slide.texts.join('\n')}`).join('\n\n');
}

export async function extractSourceDocument(file: File): Promise<SourceDocument> {
  if (file.size <= 0 || file.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(`${file.name}: source files must be between 1 byte and 100 MB.`);
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  let text = '';

  if (['txt','md','csv','json','log','xml','html'].includes(extension)) {
    text = await file.text();
  } else if (extension === 'pdf') {
    text = await pdfText(new Uint8Array(await file.arrayBuffer()));
  } else if (['docx','xlsx','pptx'].includes(extension)) {
    text = officeText(new Uint8Array(await file.arrayBuffer()));
  } else {
    throw new Error(`${file.name}: unsupported RAG source type.`);
  }

  if (!text.trim()) throw new Error(`${file.name}: no indexable text was found.`);
  return { id: sourceId(file.name), name: file.name, text };
}
