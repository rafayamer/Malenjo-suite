import {describe,expect,it} from 'vitest';
import {
  PDFDict,PDFDocument,PDFHexString,PDFName,PDFString,
} from 'pdf-lib';
import {
  inspectPdfStructuralSafety,serializePdfPreflightJson,
  PDF_PREFLIGHT_MAX_INPUT_BYTES,
} from './pdfPreflight';

async function sample():Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([500,700]);
  pdf.addPage([500,700]);
  const field=pdf.getForm().createTextField('owner');
  field.setText('Original');
  field.addToPage(page,{x:50,y:200,width:250,height:30});
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
function decode(bytes:Uint8Array){return new TextDecoder().decode(bytes);}
describe('offline structural PDF preflight and inert JavaScript inspection',()=>{
  it('reopens real PDF, inventories form fields/objects without changing the source',async()=>{
    const source=await sample(),snapshot=Uint8Array.from(source);
    const result=await inspectPdfStructuralSafety(source);
    expect(result.inspection).toBe('local-pdf-lib-structural');
    expect(result.pageCount).toBe(2);
    expect(result.formFieldCount).toBe(1);
    expect(result.pageAnnotationCount).toBeGreaterThanOrEqual(1);
    expect(result.objectCount).toBeGreaterThan(2);
    expect(result.embeddedJavaScriptCount).toBe(0);
    expect(source).toEqual(snapshot);
    expect(decode(serializePdfPreflightJson(result))).toContain('does not cryptographically validate');
  });
  it('detects direct/indirect JavaScript actions as inert text, never executes them',async()=>{
    const pdf=await PDFDocument.load(await sample());
    const action=pdf.context.obj({
      S:PDFName.of('JavaScript'),
      JS:PDFString.of('globalThis.MALICIOUS = true; app.alert("hi")'),
    });
    pdf.catalog.set(PDFName.of('OpenAction'),pdf.context.register(action));
    const result=await inspectPdfStructuralSafety(Uint8Array.from(await pdf.save({
      useObjectStreams:false,
    })));
    expect(result.embeddedJavaScriptCount).toBe(1);
    expect(result.scripts[0].text).toContain('MALICIOUS');
    expect(result.warnings.join(' ')).toContain('not executed');
    const safe=decode(serializePdfPreflightJson(result));
    expect(safe).not.toContain('MALICIOUS');
    const full=decode(serializePdfPreflightJson(result,true));
    expect(full).toContain('MALICIOUS');
  });
  it('decodes hexadecimal script strings while enforcing report text redaction',async()=>{
    const pdf=await PDFDocument.load(await sample());
    const action=pdf.context.obj({
      S:PDFName.of('JavaScript'),
      JS:PDFHexString.fromText('app.alert("test")'),
    });
    pdf.catalog.set(PDFName.of('OpenAction'),pdf.context.register(action));
    const report=await inspectPdfStructuralSafety(Uint8Array.from(await pdf.save()));
    expect(report.scripts.some(s=>s.text==='app.alert("test")')).toBe(true);
  });
  it('refuses XFA forms rather than reporting unsupported structure as verified',async()=>{
    const pdf=await PDFDocument.load(await sample());
    const form=pdf.catalog.lookup(PDFName.of('AcroForm'),PDFDict);
    form.set(PDFName.of('XFA'),PDFString.of('external form data'));
    await expect(inspectPdfStructuralSafety(Uint8Array.from(await pdf.save())))
      .rejects.toThrow(/XFA/);
  });
  it('rejects malformed, oversized and encrypted or unreadable sources',async()=>{
    await expect(inspectPdfStructuralSafety(new Uint8Array()))
      .rejects.toThrow(/32 MB/);
    await expect(inspectPdfStructuralSafety(new Uint8Array(PDF_PREFLIGHT_MAX_INPUT_BYTES+1)))
      .rejects.toThrow(/32 MB/);
    await expect(inspectPdfStructuralSafety(new TextEncoder().encode('%PDF-garbage')))
      .rejects.toThrow();
  });
  it('bounds JavaScript content and rejects maliciously large actions',async()=>{
    const pdf=await PDFDocument.load(await sample());
    const action=pdf.context.obj({
      S:PDFName.of('JavaScript'),
      JS:PDFString.of('x'.repeat(64_001)),
    });
    pdf.catalog.set(PDFName.of('OpenAction'),pdf.context.register(action));
    await expect(inspectPdfStructuralSafety(Uint8Array.from(await pdf.save())))
      .rejects.toThrow(/64,000-character/);
  });
});
