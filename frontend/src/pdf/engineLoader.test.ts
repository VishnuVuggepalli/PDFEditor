import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeToasts, type ToastInput } from '../api/toastBus';
import { configuredEngine, ENGINE_STORAGE_KEY, loadPdf, setEngineOverride } from './engineLoader';

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
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('configuredEngine', () => {
  it('defaults to mupdf', () => {
    vi.stubEnv('VITE_PDF_ENGINE', undefined);
    expect(configuredEngine()).toBe('mupdf');
  });

  it('treats unknown values as the mupdf default', () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'acrobat');
    expect(configuredEngine()).toBe('mupdf');
  });

  it('selects pdfjs when flagged', () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'pdfjs');
    expect(configuredEngine()).toBe('pdfjs');
  });
});

describe('runtime overrides', () => {
  it('localStorage pdfEngine beats the build-time default', () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'mupdf');
    window.localStorage.setItem(ENGINE_STORAGE_KEY, 'pdfjs');
    expect(configuredEngine()).toBe('pdfjs');
  });

  it('?engine= URL param beats localStorage and the default', () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'mupdf');
    window.localStorage.setItem(ENGINE_STORAGE_KEY, 'mupdf');
    window.history.replaceState(null, '', '/?engine=pdfjs#/doc/abc');
    expect(configuredEngine()).toBe('pdfjs');
  });

  it('ignores invalid override values', () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'mupdf');
    window.localStorage.setItem(ENGINE_STORAGE_KEY, 'acrobat');
    window.history.replaceState(null, '', '/?engine=ghostscript');
    expect(configuredEngine()).toBe('mupdf');
  });

  it('setEngineOverride persists and clears the localStorage key', () => {
    setEngineOverride('pdfjs');
    expect(window.localStorage.getItem(ENGINE_STORAGE_KEY)).toBe('pdfjs');
    setEngineOverride(null);
    expect(window.localStorage.getItem(ENGINE_STORAGE_KEY)).toBeNull();
  });

  it('loadPdf dispatches through the override', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'mupdf');
    window.localStorage.setItem(ENGINE_STORAGE_KEY, 'pdfjs');
    await loadPdf('/doc.pdf');
    expect(pdfjsLoad).toHaveBeenCalledWith('/doc.pdf');
    expect(mupdfLoad).not.toHaveBeenCalled();
  });
});

describe('pdfjs-default builds prune the mupdf engine', () => {
  it('configuredEngine degrades a mupdf override to pdfjs', () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'pdfjs');
    window.localStorage.setItem(ENGINE_STORAGE_KEY, 'mupdf');
    expect(configuredEngine()).toBe('pdfjs');
    window.history.replaceState(null, '', '/?engine=mupdf#/doc/abc');
    expect(configuredEngine()).toBe('pdfjs');
  });

  it('loadPdf uses pdf.js and toasts "unavailable in this build" exactly once', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'pdfjs');
    window.localStorage.setItem(ENGINE_STORAGE_KEY, 'mupdf');
    const toasts: ToastInput[] = [];
    const unsubscribe = subscribeToasts((t) => toasts.push(t));
    try {
      // No other test triggers the unavailable toast, so the module-level
      // once-per-session latch is still unset when this test runs.
      await loadPdf('/doc.pdf');
      await loadPdf('/doc2.pdf');
      expect(mupdfLoad).not.toHaveBeenCalled();
      expect(pdfjsLoad).toHaveBeenCalledTimes(2);
      expect(toasts).toHaveLength(1);
      expect(toasts[0].title).toBe('mupdf engine unavailable in this build');
    } finally {
      unsubscribe();
    }
  });

  it('does not toast when no mupdf override is present', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'pdfjs');
    const toasts: ToastInput[] = [];
    const unsubscribe = subscribeToasts((t) => toasts.push(t));
    try {
      await loadPdf('/doc.pdf');
      expect(pdfjsLoad).toHaveBeenCalledWith('/doc.pdf');
      expect(toasts).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });
});

describe('loadPdf dispatch', () => {
  it('routes to the mupdf engine by default', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', undefined);
    await loadPdf('/doc.pdf');
    expect(mupdfLoad).toHaveBeenCalledWith('/doc.pdf');
    expect(pdfjsLoad).not.toHaveBeenCalled();
  });

  it('routes to the pdf.js engine when flagged', async () => {
    vi.stubEnv('VITE_PDF_ENGINE', 'pdfjs');
    await loadPdf('/doc.pdf');
    expect(pdfjsLoad).toHaveBeenCalledWith('/doc.pdf');
    expect(mupdfLoad).not.toHaveBeenCalled();
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
