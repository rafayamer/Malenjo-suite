import { PDFDocument } from 'pdf-lib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { MetadataRecord } from './types';

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeXml(match?.[1]?.replace(/<[^>]+>/g, '') ?? '');
}

function iso(value?: Date): string {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : '';
}

export async function inspectMetadata(bytes: Uint8Array, name = ''): Promise<MetadataRecord> {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false });
    return {
      title: pdf.getTitle() ?? '',
      author: pdf.getAuthor() ?? '',
      subject: pdf.getSubject() ?? '',
      keywords: pdf.getKeywords() ?? '',
      creator: pdf.getCreator() ?? '',
      producer: pdf.getProducer() ?? '',
      created: iso(pdf.getCreationDate()),
      modified: iso(pdf.getModificationDate()),
      format: 'pdf',
      warnings: ['Standard PDF metadata fields are shown. Use Security Center CDR for a destructive clean-room export that drops hidden objects, scripts and attachments.'],
    };
  }

  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const core = files['docProps/core.xml'];
    const app = files['docProps/app.xml'];
    const coreXml = core ? strFromU8(core) : '';
    const appXml = app ? strFromU8(app) : '';
    return {
      title: xmlValue(coreXml, 'dc:title'),
      author: xmlValue(coreXml, 'dc:creator'),
      subject: xmlValue(coreXml, 'dc:subject'),
      keywords: xmlValue(coreXml, 'cp:keywords'),
      creator: xmlValue(coreXml, 'cp:lastModifiedBy'),
      producer: xmlValue(appXml, 'Application'),
      created: xmlValue(coreXml, 'dcterms:created'),
      modified: xmlValue(coreXml, 'dcterms:modified'),
      format: 'ooxml',
      warnings: ['OOXML core/application properties are shown. Embedded files, comments, custom XML and revision content require separate review.'],
    };
  }

  return {
    title: name,
    author: '',
    subject: '',
    keywords: '',
    creator: '',
    producer: '',
    created: '',
    modified: '',
    format: 'other',
    warnings: ['No structured Phase 6 metadata adapter is available for this file type.'],
  };
}

export async function sanitizeMetadata(
  bytes: Uint8Array,
  metadata: Pick<MetadataRecord, 'title' | 'author' | 'subject' | 'keywords'>,
): Promise<Uint8Array> {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    pdf.setTitle(metadata.title || '');
    pdf.setAuthor(metadata.author || '');
    pdf.setSubject(metadata.subject || '');
    pdf.setKeywords(metadata.keywords.split(',').map((item) => item.trim()).filter(Boolean));
    pdf.setCreator('MALENJO Metadata Studio');
    pdf.setProducer('MALENJO Metadata Studio');
    const epoch = new Date(0);
    pdf.setCreationDate(epoch);
    pdf.setModificationDate(epoch);
    return Uint8Array.from(await pdf.save({ useObjectStreams: false }));
  }

  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const existing = files['docProps/core.xml'] ? strFromU8(files['docProps/core.xml']) : '';
    const core = existing || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"></cp:coreProperties>`;

    const fields: Array<[string,string]> = [
      ['dc:title', metadata.title],
      ['dc:creator', metadata.author],
      ['dc:subject', metadata.subject],
      ['cp:keywords', metadata.keywords],
      ['cp:lastModifiedBy', 'MALENJO Metadata Studio'],
    ];
    let next = core;
    for (const [tag, value] of fields) {
      const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');
      const replacement = `<${tag}>${escapeXml(value || '')}</${tag}>`;
      if (pattern.test(next)) next = next.replace(pattern, replacement);
      else next = next.replace(/<\/cp:coreProperties>/i, `${replacement}</cp:coreProperties>`);
    }

    delete files['docProps/custom.xml'];
    files['docProps/core.xml'] = strToU8(next);
    if (files['docProps/app.xml']) {
      files['docProps/app.xml'] = strToU8(strFromU8(files['docProps/app.xml']).replace(
        /<Application\b[^>]*>[\s\S]*?<\/Application>/i,
        '<Application>MALENJO Metadata Studio</Application>',
      ));
    }
    return zipSync(files, { level: 6 });
  }

  throw new Error('Metadata sanitization is currently supported for PDF and OOXML documents.');
}
