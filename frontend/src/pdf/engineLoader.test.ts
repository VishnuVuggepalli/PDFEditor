import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuredEngine, loadPdf } from './engineLoader';

const pdfjsLoad = vi.hoisted(() => vi.fn(async () => ({ engine: 'pdfjs' })));
const mupdfLoad = vi.hoisted(() => vi.fn(async () => ({ engine: 'mupdf' })));

vi.mock('./engine', () => ({ loadPdf: pdfjsLoad }));
vi.mock('./engineMupdf', () => ({ loadPdfMupdf: mupdfLoad }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
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
