import { describe, expect, it } from 'vitest';
import { buildSupportBundle, filterHelpGuides, redactDiagnosticValue, serializeSupportBundle } from './supportModel';
import { modules } from '../modules/registry';

describe('Help / Support diagnostics', () => {
  it('redacts secrets, document identifiers and local paths recursively', () => {
    const redacted=redactDiagnosticValue({
      password:'secret',
      apiToken:'abc',
      documentName:'private.pdf',
      nested:{
        bearer:'Bearer super-secret-token',
        detail:'failed at C:\\Users\\student\\Documents\\private.pdf',
        path:'/home/student/private.pdf',
      },
    }) as Record<string, unknown>;

    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.apiToken).toBe('[REDACTED]');
    expect(redacted.documentName).toBe('[REDACTED]');
    expect(JSON.stringify(redacted)).not.toContain('super-secret-token');
    expect(JSON.stringify(redacted)).not.toContain('private.pdf');
  });

  it('builds a bounded support bundle without document names or contents', () => {
    const bundle=buildSupportBundle({
      version:'0.1.0',
      build:'test',
      runtime:'browser',
      userAgent:'vitest',
      language:'en',
      platform:'test',
      online:false,
      openDocumentCount:3,
      modules,
      providers:[{id:'ai',name:'AI',state:'unavailable',detail:'not running'}],
      systemStatus:{product:'Malenjo Suite',token:'must-not-leak'},
    });
    const serialized=serializeSupportBundle(bundle);
    expect(bundle.privacy).toEqual({
      documentNamesIncluded:false,
      documentContentsIncluded:false,
      ocrTextIncluded:false,
      secretsIncluded:false,
    });
    expect(bundle.application.openDocumentCount).toBe(3);
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).toContain('[REDACTED]');
  });

  it('searches troubleshooting guides by multiple terms', () => {
    expect(filterHelpGuides('OCR searchable').map((guide)=>guide.id)).toContain('scanner-ocr');
    expect(filterHelpGuides('Ctrl K').map((guide)=>guide.id)).toContain('getting-started');
    expect(filterHelpGuides('diagnostic bundle').map((guide)=>guide.id)).toContain('troubleshooting');
  });
});
