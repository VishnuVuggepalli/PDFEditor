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

/** localStorage key for the persistent runtime override. */
export const ENGINE_STORAGE_KEY = 'pdfEngine';

function normalizeEngine(v: string | null | undefined): PdfEngineName | null {
  return v === 'pdfjs' || v === 'mupdf' ? v : null;
}

/** Engine for the current session. Precedence:
 *  1. URL `?engine=pdfjs|mupdf` (one-off debugging; works with hash routes)
 *  2. localStorage `pdfEngine` (persistent override, see InfoTab toggle)
 *  3. build-time VITE_PDF_ENGINE default
 */
export function configuredEngine(): PdfEngineName {
  try {
    const fromUrl = normalizeEngine(new URLSearchParams(window.location.search).get('engine'));
    if (fromUrl) return fromUrl;
    const stored = normalizeEngine(window.localStorage.getItem(ENGINE_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // no window/localStorage (tests, exotic privacy modes): use build default
  }
  return import.meta.env.VITE_PDF_ENGINE === 'mupdf' ? 'mupdf' : 'pdfjs';
}

/** Persist (or clear) the runtime engine override. Takes effect on the next
 * document load; callers that want it immediately should reload. */
export function setEngineOverride(name: PdfEngineName | null): void {
  try {
    if (name) window.localStorage.setItem(ENGINE_STORAGE_KEY, name);
    else window.localStorage.removeItem(ENGINE_STORAGE_KEY);
  } catch {
    // localStorage unavailable: the override simply does not persist
  }
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
