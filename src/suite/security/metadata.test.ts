import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { inspectMetadata, sanitizeMetadata } from './metadata';

describe('Metadata Studio', () => {
  it('inspects and rewrites standard PDF metadata', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 300]);
    pdf.setTitle('Secret title');
    pdf.setAuthor('Alice');
    const bytes = Uint8Array.from(await pdf.save());

    const before = await inspectMetadata(bytes, 'sample.pdf');
    expect(before.title).toBe('Secret title');
    expect(before.author).toBe('Alice');

    const sanitized = await sanitizeMetadata(bytes, {
      title:'Public title',
      author:'',
      subject:'',
      keywords:'',
    });
    const after = await inspectMetadata(sanitized, 'sample.pdf');
    expect(after.title).toBe('Public title');
    expect(after.author).toBe('');
  });

  it('removes custom properties together with package references and keeps other relationships', async () => {
    const source=zipSync({
      '[Content_Types].xml':strToU8('<Types><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/><Override PartName="/word/document.xml" ContentType="keep"/></Types>'),
      '_rels/.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml':strToU8('<w:document/>'),
      'docProps/custom.xml':strToU8('<Properties/>'),
    });
    const sanitized=await sanitizeMetadata(source,{title:'',author:'',subject:'',keywords:''});
    const files=unzipSync(sanitized);
    expect(files['docProps/custom.xml']).toBeUndefined();
    expect(strFromU8(files['_rels/.rels'])).not.toContain('custom-properties');
    expect(strFromU8(files['_rels/.rels'])).toContain('officeDocument');
    expect(strFromU8(files['[Content_Types].xml'])).not.toContain('custom.xml');
    expect(strFromU8(files['[Content_Types].xml'])).toContain('/word/document.xml');
  });

  it('removes OOXML custom properties while preserving the package', async () => {
    const core = '<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:title>Old</dc:title><dc:creator>Alice</dc:creator></cp:coreProperties>';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document/>'),
      'docProps/core.xml': strToU8(core),
      'docProps/custom.xml': strToU8('<Properties><secret>value</secret></Properties>'),
    });
    const sanitized = await sanitizeMetadata(bytes, {
      title:'New',
      author:'',
      subject:'',
      keywords:'',
    });
    const files = unzipSync(sanitized);
    expect(files['docProps/custom.xml']).toBeUndefined();
    expect(strFromU8(files['docProps/core.xml'])).toContain('<dc:title>New</dc:title>');
    expect(strFromU8(files['word/document.xml'])).toContain('w:document');
  });
});
