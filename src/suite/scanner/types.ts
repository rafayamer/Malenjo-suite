export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PerspectiveQuad {
  tlx: number; tly: number;
  trx: number; try: number;
  brx: number; bry: number;
  blx: number; bly: number;
}

export interface ScanAdjustments {
  rotation: 0 | 90 | 180 | 270;
  crop: CropRect;
  perspective: PerspectiveQuad;
  perspectiveEnabled: boolean;
  brightness: number;
  contrast: number;
  grayscale: boolean;
}

export interface OcrPageResult {
  text: string;
  confidence: number;
  latencyMs: number;
  engine: 'paddle-local' | 'tesseract-portable';
  cached: boolean;
}

export interface ScanPage {
  id: string;
  name: string;
  sourceUrl: string;
  mimeType: string;
  originalBytes: number;
  width: number;
  height: number;
  adjustments: ScanAdjustments;
  ocr?: OcrPageResult;
}

export const DEFAULT_PERSPECTIVE: PerspectiveQuad = {
  tlx: 0, tly: 0,
  trx: 1, try: 0,
  brx: 1, bry: 1,
  blx: 0, bly: 1,
};

export const DEFAULT_SCAN_ADJUSTMENTS: ScanAdjustments = {
  rotation: 0,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  perspective: DEFAULT_PERSPECTIVE,
  perspectiveEnabled: false,
  brightness: 100,
  contrast: 100,
  grayscale: false,
};
