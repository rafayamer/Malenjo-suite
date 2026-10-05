import { invoke, isTauri } from '@tauri-apps/api/core';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import type { OcrPageResult } from './types';

export interface PaddleStatus {
  available: boolean;
  python: string | null;
  workerPath: string | null;
  message: string;
}

interface RecognizeOptions {
  preferPaddle?: boolean;
  onProgress?(progress: number, status: string): void;
}

const cache = new Map<string, OcrPageResult>();
let activeWorker: Worker | null = null;
let activeJob: { id: string; engine: 'paddle-local' | 'tesseract-portable' } | null = null;
let generation = 0;

async function digestBlob(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function getPaddleStatus(): Promise<PaddleStatus> {
  if (!isTauri()) {
    return {
      available: false,
      python: null,
      workerPath: null,
      message: 'PaddleOCR is available only in the desktop runtime when the optional local pack is installed.',
    };
  }
  return invoke<PaddleStatus>('paddle_ocr_status');
}

function jobId(): string {
  return `ocr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function recognizePaddle(blob: Blob, onProgress?: RecognizeOptions['onProgress']): Promise<OcrPageResult> {
  const id = jobId();
  const token = ++generation;
  activeJob = { id, engine: 'paddle-local' };
  onProgress?.(0.08, 'Starting local PaddleOCR worker');

  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  const started = performance.now();
  const result = await invoke<{ text: string; confidence: number }>('paddle_ocr_image', {
    bytes,
    language: 'en',
    jobId: id,
  });

  if (token !== generation) throw new Error('OCR job cancelled.');
  onProgress?.(1, 'OCR complete');
  return {
    text: result.text,
    confidence: result.confidence <= 1 ? result.confidence * 100 : result.confidence,
    latencyMs: Math.round(performance.now() - started),
    engine: 'paddle-local',
    cached: false,
  };
}

async function recognizeTesseract(blob: Blob, onProgress?: RecognizeOptions['onProgress']): Promise<OcrPageResult> {
  const id = jobId();
  const token = ++generation;
  activeJob = { id, engine: 'tesseract-portable' };

  const started = performance.now();
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    logger: (message) => onProgress?.(message.progress ?? 0, message.status ?? 'OCR'),
  });
  activeWorker = worker;

  try {
    const result = await worker.recognize(blob);
    if (token !== generation) throw new Error('OCR job cancelled.');
    return {
      text: result.data.text ?? '',
      confidence: result.data.confidence ?? 0,
      latencyMs: Math.round(performance.now() - started),
      engine: 'tesseract-portable',
      cached: false,
    };
  } finally {
    activeWorker = null;
    activeJob = null;
    await worker.terminate().catch(() => undefined);
  }
}

export async function recognizeScan(blob: Blob, options: RecognizeOptions = {}): Promise<OcrPageResult> {
  const hash = await digestBlob(blob);
  const cached = cache.get(hash);
  if (cached) return { ...cached, cached: true };

  let result: OcrPageResult;
  if (options.preferPaddle !== false && isTauri()) {
    const status = await getPaddleStatus();
    result = status.available
      ? await recognizePaddle(blob, options.onProgress)
      : await recognizeTesseract(blob, options.onProgress);
  } else {
    result = await recognizeTesseract(blob, options.onProgress);
  }

  cache.set(hash, result);
  activeJob = null;
  return result;
}

export async function cancelActiveOcr(): Promise<void> {
  generation += 1;
  const job = activeJob;
  activeJob = null;

  if (job?.engine === 'paddle-local' && isTauri()) {
    await invoke<boolean>('cancel_paddle_ocr', { jobId: job.id }).catch(() => false);
  }
  if (activeWorker) {
    const worker = activeWorker;
    activeWorker = null;
    await worker.terminate().catch(() => undefined);
  }
}

export function clearOcrCache(): void {
  cache.clear();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function levenshteinDistance(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return previous[b.length];
}

export function ocrAccuracy(expected: string, actual: string): number {
  const normalized = normalizeText(expected);
  if (!normalized.length) return actual.trim() ? 0 : 100;
  const distance = levenshteinDistance(expected, actual);
  return Math.max(0, Math.round((1 - distance / normalized.length) * 1000) / 10);
}
