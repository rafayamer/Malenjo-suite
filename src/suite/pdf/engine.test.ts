import { beforeEach, describe, expect, it, vi } from 'vitest';

const pdfJs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist', () => ({
  getDocument: pdfJs.getDocument,
  GlobalWorkerOptions: pdfJs.GlobalWorkerOptions,
}));

import { disposePdf, loadPdfBytes } from './engine';

beforeEach(() => pdfJs.getDocument.mockReset());

describe('PDF.js load task ownership', () => {
  it('gives the worker a distinct copy of caller-owned bytes', async () => {
    const destroy = vi.fn(async () => {});
    const document = { numPages: 2 };
    pdfJs.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy });

    const source = new Uint8Array([37, 80, 68, 70, 45, 49]);
    const result = await loadPdfBytes(source);
    expect(result.document).toBe(document);

    const workerBytes = (pdfJs.getDocument.mock.calls[0][0] as { data: Uint8Array }).data;
    expect(workerBytes).not.toBe(source);
    expect(workerBytes.buffer).not.toBe(source.buffer);
    workerBytes[0] = 0;
    expect(source[0]).toBe(37);
    await disposePdf(result);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('clones ArrayBuffer input instead of transferring the original', async () => {
    const destroy = vi.fn(async () => {});
    pdfJs.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1 }), destroy });
    const source = Uint8Array.from([37, 80, 68, 70, 45]);

    await loadPdfBytes(source.buffer);
    const workerBytes = (pdfJs.getDocument.mock.calls[0][0] as { data: Uint8Array }).data;
    expect(workerBytes.buffer).not.toBe(source.buffer);
    workerBytes[1] = 0;
    expect(source[1]).toBe(80);
  });

  it('destroys the failed loading task without masking the parse error', async () => {
    const cause = new Error('Invalid PDF structure');
    const destroy = vi.fn(async () => {});
    pdfJs.getDocument.mockReturnValue({ promise: Promise.reject(cause), destroy });

    await expect(loadPdfBytes(new Uint8Array([1, 2, 3]))).rejects.toBe(cause);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('preserves the parse error when worker cleanup also fails', async () => {
    const cause = new Error('Worker startup failed');
    const destroy = vi.fn(async () => { throw new Error('Worker teardown failed'); });
    pdfJs.getDocument.mockReturnValue({ promise: Promise.reject(cause), destroy });

    await expect(loadPdfBytes(new Uint8Array([1]))).rejects.toBe(cause);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
