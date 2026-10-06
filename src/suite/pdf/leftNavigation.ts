export const PDF_LEFT_PANEL_IDS = [
  'pages',
  'bookmarks',
  'attachments',
  'layers',
  'signatures',
  'comments',
  'search',
] as const;

export type PdfLeftPanelId = typeof PDF_LEFT_PANEL_IDS[number];

export interface PdfLeftPanelItem {
  id: PdfLeftPanelId;
  label: string;
  description: string;
}

export const PDF_LEFT_PANEL_ITEMS: readonly PdfLeftPanelItem[] = [
  { id: 'pages', label: 'Pages', description: 'Thumbnails and page selection' },
  { id: 'bookmarks', label: 'Bookmarks', description: 'Document outline and destinations' },
  { id: 'attachments', label: 'Attachments', description: 'Embedded-file actions' },
  { id: 'layers', label: 'Layers', description: 'Optional-content groups' },
  { id: 'signatures', label: 'Signatures', description: 'Signature-field inventory' },
  { id: 'comments', label: 'Comments', description: 'PDF comment authoring' },
  { id: 'search', label: 'Search', description: 'Persistent text-search results' },
] as const;

export const DEFAULT_PDF_LEFT_PANEL: PdfLeftPanelId = 'pages';

export function isPdfLeftPanelId(value: string): value is PdfLeftPanelId {
  return (PDF_LEFT_PANEL_IDS as readonly string[]).includes(value);
}

export function pdfLeftPanelItem(id: PdfLeftPanelId): PdfLeftPanelItem {
  return PDF_LEFT_PANEL_ITEMS.find((item) => item.id === id) ?? PDF_LEFT_PANEL_ITEMS[0];
}
