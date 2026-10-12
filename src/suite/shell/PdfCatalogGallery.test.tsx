import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PdfCatalogGallery,{catalogMissingIcons,pdfCatalogCommands} from './PdfCatalogGallery';
import { LEGACY_TOOL_REQUIREMENTS, PDF_COMMANDS } from '../commands/masterCatalog';

describe('Master v2 contextual PDF feature galleries',()=>{
  it('has a distinct real Lucide icon for every registered feature icon type',()=>{
    expect(catalogMissingIcons()).toEqual([]);
  });

  it('exposes the entire 90-feature set across the specified ten tabs',()=>{
    const categories=[
      'Home','Edit','Organize','Optimize','Convert',
      'Forms','Review','Protect','Automate','Tools',
    ] as const;
    const catalog=categories.filter(category=>category!=='Home')
      .flatMap(category=>pdfCatalogCommands(category));
    expect(catalog).toHaveLength(90);
    expect(new Set(catalog.map(c=>c.id)).size).toBe(90);
    expect(pdfCatalogCommands('Home').length).toBeGreaterThanOrEqual(15);
    expect(LEGACY_TOOL_REQUIREMENTS.every(entry=>
      entry.requirementIds.every(id=>pdfCatalogCommands('Home').some(c=>c.id===id)))).toBe(true);
    expect(PDF_COMMANDS.every(c=>pdfCatalogCommands(c.category).some(other=>other.id===c.id))).toBe(true);
  });

  it('keeps gallery triggers keyboard reachable with accessible explanation',()=>{
    const html=renderToStaticMarkup(<PdfCatalogGallery category="Organize"/>);
    expect(html).toContain('aria-label="Browse Organize tools"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('More tools');
    expect(html).toContain('aria-expanded="false"');
  });
});
