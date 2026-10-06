import type { PdfToolProvider } from './backend';
import { stirlingCorePdfProvider } from './stirlingCore';

/**
 * MALENJO composition root for PDF transformation providers.
 * Workspace/UI components depend only on PdfToolProvider.
 */
export const defaultPdfToolProvider:PdfToolProvider=stirlingCorePdfProvider;
