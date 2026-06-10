/** Engine selection behind the VITE_PDF_ENGINE feature flag.
 *
 * - 'mupdf' (default): the mupdf-WASM engine (adds in-place text editing).
 * - 'pdfjs': the proven pdf.js engine, kept fully functional as the
 *   compatibility fallback (set VITE_PDF_ENGINE=pdfjs to flip back).
 *
 * Both engines are loaded via dynamic import so the unused one never ships
 * to the browser; the mupdf wasm (~3.4 MB brotli) is a separate async chunk.
 *
 * Build-time pruning: in pdfjs-default builds (VITE_PDF_ENGINE=pdfjs) every
 * mupdf import below sits inside a branch on a literal
 * `import.meta.env.VITE_PDF_ENGINE !== 'pdfjs'` check that Vite's define
 * replaces with a constant `false`, so Rollup drops the mupdf chunks AND the
 * ~9.6 MB wasm asset from dist entirely. The runtime
 * `?engine=` / localStorage override therefore cannot reach mupdf in such a
 * build — configuredEngine() degrades it to 'pdfjs' and loadPdf raises a
 * one-time "not included in this build" toast instead of failing. In
 * mupdf-default builds (the shipped default) both engines stay available and
 * the override works in both directions, because pdf.js doubles as the
 * per-document fallback engine.
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

/* Build-flag checks below stay direct `import.meta.env.VITE_PDF_ENGINE`
 * comparisons at each use site: Vite's define replaces them with literals,
 * which is what lets Rollup prune the mupdf branch (and its chunks + wasm)
 * from pdfjs-default builds. Hoisting the comparison through a helper or
 * module const would weaken that guarantee and break vi.stubEnv in tests. */

function normalizeEngine(v: string | null | undefined): PdfEngineName | null {
  return v === 'pdfjs' || v === 'mupdf' ? v : null;
}

/** Runtime override requested via URL/localStorage, before availability is
 * taken into account. Null when no (valid) override is present. */
function requestedOverride(): PdfEngineName | null {
  try {
    const fromUrl = normalizeEngine(new URLSearchParams(window.location.search).get('engine'));
    if (fromUrl) return fromUrl;
    return normalizeEngine(window.localStorage.getItem(ENGINE_STORAGE_KEY));
  } catch {
    // no window/localStorage (tests, exotic privacy modes): no override
    return null;
  }
}

/** Engine for the current session. Precedence:
 *  1. URL `?engine=pdfjs|mupdf` (one-off debugging; works with hash routes)
 *  2. localStorage `pdfEngine` (persistent override, see InfoTab toggle)
 *  3. build-time VITE_PDF_ENGINE default
 * In pdfjs-default builds a 'mupdf' override degrades to 'pdfjs' because the
 * mupdf engine is pruned from those builds (see header).
 */
export function configuredEngine(): PdfEngineName {
  if (import.meta.env.VITE_PDF_ENGINE === 'pdfjs') {
    // pdfjs-default build: mupdf is pruned, so every road leads to pdf.js.
    return 'pdfjs';
  }
  return requestedOverride() ?? 'mupdf';
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

/** One toast per session when an override asks for the pruned engine. */
let warnedMupdfUnavailable = false;

/** Load a PDF from a URL using the configured engine. */
export async function loadPdf(url: string): Promise<PdfHandle> {
  if (import.meta.env.VITE_PDF_ENGINE !== 'pdfjs') {
    if (configuredEngine() === 'mupdf') {
      try {
        const { loadPdfMupdf } = await import('./engineMupdf');
        return await loadPdfMupdf(url);
      } catch (e) {
        // Per-document fallback: mupdf failed, retry the same URL with
        // pdf.js. Exactly one toast per fallback; the console carries the
        // real error.
        console.error('[pdf-engine] mupdf engine failed; falling back to pdf.js for', url, e);
        // If the shared worker itself died (as opposed to one bad document),
        // tear it down so the next document gets a fresh worker instead of a
        // dead port.
        if (e instanceof Error && e.name === 'MupdfWorkerError') {
          const { terminateMupdfWorker } = await import('./mupdfWorkerClient');
          terminateMupdfWorker();
        }
        emitToast({
          type: 'error',
          title: 'Falling back to compatibility renderer',
          msg: 'The mupdf engine could not open this document; using pdf.js instead.',
        });
      }
    }
  } else if (requestedOverride() === 'mupdf' && !warnedMupdfUnavailable) {
    // Runtime override asked for the engine this build pruned: degrade
    // gracefully (pdf.js renders the document) and say so exactly once.
    warnedMupdfUnavailable = true;
    emitToast({
      type: 'error',
      title: 'mupdf engine unavailable in this build',
      msg: 'This build only includes the pdf.js renderer; the engine override was ignored.',
    });
  }
  return loadWithPdfjs(url);
}
