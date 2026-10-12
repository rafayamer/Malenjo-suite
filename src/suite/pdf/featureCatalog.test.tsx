import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PDF_TASK_CATEGORIES } from './taskToolbar';
import { plannedPdfFeatures } from './featureCatalog';
import { PdfFeatureIcon } from './PdfFeatureIcon';

describe('PDF manipulation feature discoverability', () => {
  it('keeps unverified PDF-to-Office conversion targets visible without enabling conversion', () => {
    const conversions=plannedPdfFeatures('convert');
    expect(conversions.map(item=>item.id)).toEqual(['to-docx','to-xlsx','to-pptx']);
    for(const item of conversions){
      expect(item.reason).toContain('not release-ready');
      expect(renderToStaticMarkup(<PdfFeatureIcon id={item.id} label={item.label}/>)).toContain('<svg');
    }
    expect(new Set(conversions.map(item=>item.label)).size).toBe(3);
  });

  it('documents truthful, non-executable placeholder requirements by ribbon category', () => {
    const all=PDF_TASK_CATEGORIES.flatMap(category=>plannedPdfFeatures(category));
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(new Set(all.map(x=>x.id)).size).toBe(all.length);
    for(const feature of all) {
      expect(feature.label.trim().length).toBeGreaterThan(3);
      expect(feature.reason.trim().length).toBeGreaterThan(30);
      expect(renderToStaticMarkup(
        <PdfFeatureIcon id={feature.id} label={feature.label}/>
      )).toContain('<svg');
    }
  });
});
