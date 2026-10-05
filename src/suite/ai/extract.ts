import { disposePdf, loadPdfBytes } from '../pdf/engine';
import { parseDocx, parsePptx, parseXlsx } from '../office/ooxml';
import type { AiMode, AiSourceSegment } from './types';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function sourceId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function plainSegments(file: File, text: string): AiSourceSegment[] {
  return [{
    sourceId:sourceId(file),
    sourceName:file.name,
    locator:'body',
    text,
  }];
}

export async function extractAiSource(file: File, mode: AiMode): Promise<AiSourceSegment[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} exceeds the 25 MB Phase 5 source limit.`);
  }

  const ext = extension(file.name);
  if (['txt','md','csv','json','log'].includes(ext)) {
    return plainSegments(file, await file.text());
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (ext === 'pdf') {
    const result = await loadPdfBytes(bytes);
    try {
      const pageLimit = mode === 'lite' ? 60 : 200;
      const pages = Math.min(result.document.numPages, pageLimit);
      const segments: AiSourceSegment[] = [];

      for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
        const page = await result.document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => 'str' in item ? item.str : '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (text) {
          segments.push({
            sourceId:sourceId(file),
            sourceName:file.name,
            locator:`page ${pageNumber}`,
            text,
          });
        }
      }

      if (!segments.length) {
        throw new Error('This PDF contains no extractable text. Run OCR first for scanned pages.');
      }
      return segments;
    } finally {
      await disposePdf(result);
    }
  }

  if (ext === 'docx') {
    const model = parseDocx(bytes);
    return model.paragraphs
      .map((text, index) => ({
        sourceId:sourceId(file),
        sourceName:file.name,
        locator:`paragraph ${index + 1}`,
        text,
      }))
      .filter((segment) => segment.text.trim());
  }

  if (ext === 'xlsx') {
    const model = parseXlsx(bytes);
    return model.cells
      .map((row, index) => ({
        sourceId:sourceId(file),
        sourceName:file.name,
        locator:`${model.sheetName} row ${index + 1}`,
        text:row.map((value, column) => value ? `${columnName(column)}=${value}` : '').filter(Boolean).join(' | '),
      }))
      .filter((segment) => segment.text.trim());
  }

  if (ext === 'pptx') {
    const model = parsePptx(bytes);
    return model.slides
      .map((slide, index) => ({
        sourceId:sourceId(file),
        sourceName:file.name,
        locator:`slide ${index + 1}`,
        text:slide.texts.join('\n'),
      }))
      .filter((segment) => segment.text.trim());
  }

  throw new Error(`${file.name} is not a Phase 5 text-extractable source type.`);
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}
