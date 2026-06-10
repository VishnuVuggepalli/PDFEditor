/** Engine selection behind the VITE_PDF_ENGINE feature flag.
 *
 * - 'pdfjs': the proven pdf.js engine.
 * - 'mupdf': the mupdf-WASM engine (adds in-place text editing).
 *
 * Both engines are loaded via dynamic import so the unused one never ships
 * to the browser; the mupdf wasm (~3.4 MB brotli) is a separate async chunk.
 *
 * If the mupdf engine fails to come up for a document (wasm fetch/compile
 * failure, worker crash, document-open error), that document transparently
 * falls back to the pdf.js engine: one toast, full detail on the console.
 */

import { emitToast } from '../api/toastBus';
import type { PdfHandle } from './engineApi';

export type PdfEngineName = 'pdfjs' | 'mupdf';

export function configuredEngine(): PdfEngineName {
  return import.meta.env.VITE_PDF_ENGINE === 'mupdf' ? 'mupdf' : 'pdfjs';
}

async function loadWithPdfjs(url: string): Promise<PdfHandle> {
  const { loadPdf: loadPdfJs } = await import('./engine');
  return loadPdfJs(url);
}

/** Per-document fallback: mupdf failed, retry the same URL with pdf.js.
 * Exactly one toast per fallback; the console carries the real error. */
async function fallBack(url: string, cause: unknown): Promise<PdfHandle> {
  console.error('[pdf-engine] mupdf engine failed; falling back to pdf.js for', url, cause);
  // If the shared worker itself died (as opposed to one bad document), tear
  // it down so the next document gets a fresh worker instead of a dead port.
  if (cause instanceof Error && cause.name === 'MupdfWorkerError') {
    const { terminateMupdfWorker } = await import('./mupdfWorkerClient');
    terminateMupdfWorker();
  }
  emitToast({
    type: 'error',
    title: 'Falling back to compatibility renderer',
    msg: 'The mupdf engine could not open this document; using pdf.js instead.',
  });
  return loadWithPdfjs(url);
}

/** Load a PDF from a URL using the configured engine. */
export async function loadPdf(url: string): Promise<PdfHandle> {
  if (configuredEngine() === 'mupdf') {
    try {
      const { loadPdfMupdf } = await import('./engineMupdf');
      return await loadPdfMupdf(url);
    } catch (e) {
      return fallBack(url, e);
    }
  }
  return loadWithPdfjs(url);
}
