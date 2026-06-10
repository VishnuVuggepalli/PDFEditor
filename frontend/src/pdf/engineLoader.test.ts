import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeToasts, type ToastInput } from '../api/toastBus';
import { configuredEngine, loadPdf } from './engineLoader';

const pdfjsLoad = vi.hoisted(() => vi.fn(async () => ({ engine: 'pdfjs' })));
const mupdfLoad = vi.hoisted(() => vi.fn(async () => ({ engine: 'mupdf' })));
const terminate = vi.hoisted(() => vi.fn());

vi.mock('./engine', () => ({ loadPdf: pdfjsLoad }));
vi.mock('./engineMupdf', () => ({ loadPdfMupdf: mupdfLoad }));
vi.mock('./mupdfWorkerClient', () => ({ terminateMupdfWorker: terminate }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('configuredEngine', () => {
  it('defaults to pdfjs', () => {
    vi.stubEnv('VITE_PDF_ENGINE', undefined);
    expect(configuredEngine()).toBe('pdfjs');
  });

  it('treats unknown values as pdfjs', () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'acrobat');
    expect(configuredEngine()).toBe('pdfjs');
  });

  it('selects mupdf when flagged', () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'mupdf');
    expect(configuredEngine()).toBe('mupdf');
  });
});

describe('loadPdf dispatch', () => {
  it('routes to the pdf.js engine by default', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', undefined);
    await loadPdf('/doc.pdf');
    expect(pdfjsLoad).toHaveBeenCalledWith('/doc.pdf');
    expect(mupdfLoad).not.toHaveBeenCalled();
  });

  it('routes to the mupdf engine when flagged', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'mupdf');
    await loadPdf('/doc.pdf');
    expect(mupdfLoad).toHaveBeenCalledWith('/doc.pdf');
    expect(pdfjsLoad).not.toHaveBeenCalled();
  });
});

describe('automatic fallback to pdf.js', () => {
  it('falls back per document when the mupdf engine fails to open', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'mupdf');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const toasts: ToastInput[] = [];
    const unsubscribe = subscribeToasts((t) => toasts.push(t));
    mupdfLoad.mockRejectedValueOnce(new Error('wasm fetch failed'));
    try {
      const handle = await loadPdf('/doc.pdf');

      expect(handle).toEqual({ engine: 'pdfjs' });
      expect(pdfjsLoad).toHaveBeenCalledWith('/doc.pdf');
      expect(toasts).toHaveLength(1);
      expect(toasts[0].title).toBe('Falling back to compatibility renderer');
      expect(consoleError).toHaveBeenCalledOnce();
      // a plain open failure must NOT kill the shared worker
      expect(terminate).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('recycles the shared worker when it crashed', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'mupdf');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = new Error('mupdf worker crashed');
    err.name = 'MupdfWorkerError';
    mupdfLoad.mockRejectedValueOnce(err);

    await expect(loadPdf('/doc.pdf')).resolves.toEqual({ engine: 'pdfjs' });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('propagates pdf.js errors when the fallback also fails', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'mupdf');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mupdfLoad.mockRejectedValueOnce(new Error('open failed'));
    pdfjsLoad.mockRejectedValueOnce(new Error('also broken'));

    await expect(loadPdf('/doc.pdf')).rejects.toThrow('also broken');
  });

  it('never falls back when pdf.js is the configured engine', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'pdfjs');
    pdfjsLoad.mockRejectedValueOnce(new Error('broken'));
    await expect(loadPdf('/doc.pdf')).rejects.toThrow('broken');
    expect(mupdfLoad).not.toHaveBeenCalled();
  });
});
