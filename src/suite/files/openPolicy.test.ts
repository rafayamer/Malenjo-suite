import { describe, expect, it } from 'vitest';
import { isMalenjoDirectOpenExtension, isMalenjoDirectOpenKind, MALENJO_DIRECT_OPEN_EXTENSIONS } from './openPolicy';

describe('MALENJO PDF-first native open policy', () => {
  it('allows only PDF/CAD/DICOM as direct Windows/browser document entry types', () => {
    expect([...MALENJO_DIRECT_OPEN_EXTENSIONS]).toEqual(['pdf','dxf','dwg','dcm','dicom']);
    for(const kind of ['pdf','cad','dicom'] as const)expect(isMalenjoDirectOpenKind(kind)).toBe(true);
    for(const kind of ['docx','xlsx','pptx','image','other'] as const)
      expect(isMalenjoDirectOpenKind(kind)).toBe(false);
  });
  it('blocks independent Office document imports including uppercase variants', () => {
    for(const name of ['sample.docx','report.XLSX','slides.PpTx','legacy.doc','archive.ppt','notes.txt','image.png'])
      expect(isMalenjoDirectOpenExtension(name)).toBe(false);
    for(const name of ['PDF','sample.pdf','drawing.DXF','drawing.dwg','scan.DCM','study.dicom'])
      expect(isMalenjoDirectOpenExtension(name)).toBe(true);
  });
});
