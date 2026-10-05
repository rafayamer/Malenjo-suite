/**
 * MALENJO-owned PDF mutation boundary.
 *
 * Phase 2 deliberately keeps render/view operations in PDF.js while write
 * operations remain behind this interface. A backend implementation must pass
 * license, Windows/offline, malformed-file, fidelity and performance gates
 * before it is registered here.
 */
export interface PdfBackendCapabilities {
  merge: boolean;
  split: boolean;
  rotatePages: boolean;
  reorderPages: boolean;
  redact: boolean;
  watermark: boolean;
  encrypt: boolean;
  optimize: boolean;
}

export interface PdfBackend {
  readonly id: string;
  readonly capabilities: PdfBackendCapabilities;
}

export const viewerOnlyPdfBackend: PdfBackend = {
  id: 'malenjo.viewer-only',
  capabilities: {
    merge: false,
    split: false,
    rotatePages: false,
    reorderPages: false,
    redact: false,
    watermark: false,
    encrypt: false,
    optimize: false,
  },
};
