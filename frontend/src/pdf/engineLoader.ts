/** Engine selection behind the VITE_PDF_ENGINE feature flag.
 *
 * - 'pdfjs' (default): the proven pdf.js engine.
 * - 'mupdf': the mupdf-WASM engine (adds in-place text editing).
 *
 * Both engines are loaded via dynamic import so the unused one never ships
 * to the browser; the mupdf wasm (~3.4 MB brotli) is a separate async chunk.
 */

import type { PdfHandle } from './engineApi';

export type PdfEngineName = 'pdfjs' | 'mupdf';

export function configuredEngine(): PdfEngineName {
  return import.meta.env.VITE_PDF_ENGINE === 'mupdf' ? 'mupdf' : 'pdfjs';
}

/** Load a PDF from a URL using the configured engine. */
export async function loadPdf(url: string): Promise<PdfHandle> {
  if (configuredEngine() === 'mupdf') {
    const { loadPdfMupdf } = await import('./engineMupdf');
    return loadPdfMupdf(url);
  }
  const { loadPdf: loadPdfJs } = await import('./engine');
  return loadPdfJs(url);
}
