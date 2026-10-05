import { describe, expect, it } from 'vitest';
import { workspaceForDocument } from './route';

describe('workspaceForDocument', () => {
  it('routes office and specialist documents to their MALENJO workspace', () => {
    expect(workspaceForDocument('pdf')).toBe('pdf');
    expect(workspaceForDocument('docx')).toBe('word');
    expect(workspaceForDocument('xlsx')).toBe('spreadsheet');
    expect(workspaceForDocument('pptx')).toBe('presentation');
    expect(workspaceForDocument('cad')).toBe('cad');
    expect(workspaceForDocument('dicom')).toBe('dicom');
  });

  it('keeps generic files in the document library', () => {
    expect(workspaceForDocument('image')).toBe('files');
    expect(workspaceForDocument('other')).toBe('files');
  });
});
