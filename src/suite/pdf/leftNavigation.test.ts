import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PDF_LEFT_PANEL,
  PDF_LEFT_PANEL_IDS,
  PDF_LEFT_PANEL_ITEMS,
  isPdfLeftPanelId,
  pdfLeftPanelItem,
} from './leftNavigation';

describe('PDF source-truth left navigation', () => {
  it('contains every canonical 53.6 PDF panel exactly once', () => {
    expect(PDF_LEFT_PANEL_IDS).toEqual([
      'pages',
      'bookmarks',
      'attachments',
      'layers',
      'signatures',
      'comments',
      'search',
    ]);
    expect(new Set(PDF_LEFT_PANEL_IDS).size).toBe(PDF_LEFT_PANEL_IDS.length);
    expect(PDF_LEFT_PANEL_ITEMS.map((item) => item.id)).toEqual(PDF_LEFT_PANEL_IDS);
  });

  it('keeps Pages as the predictable default and validates panel ids', () => {
    expect(DEFAULT_PDF_LEFT_PANEL).toBe('pages');
    expect(isPdfLeftPanelId('signatures')).toBe(true);
    expect(isPdfLeftPanelId('fake-panel')).toBe(false);
    expect(pdfLeftPanelItem('search').label).toBe('Search');
  });
});
