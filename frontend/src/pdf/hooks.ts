/** React hooks over the pdf engine. Components consume these instead of
 * importing pdfjs-dist directly. */

import { useEffect, useState } from 'react';
import { loadPdf } from './engine';
import type { PdfHandle } from './engine';

export interface PdfDocState {
  pdf: PdfHandle | null;
  error: string | null;
  loading: boolean;
}

/** Load (and own) a PdfHandle for the given URL. Destroys on URL change. */
export function usePdfDocument(url: string | null): PdfDocState {
  const [state, setState] = useState<PdfDocState>({ pdf: null, error: null, loading: !!url });

  useEffect(() => {
    if (!url) {
      setState({ pdf: null, error: null, loading: false });
      return;
    }
    let alive = true;
    let handle: PdfHandle | null = null;
    setState({ pdf: null, error: null, loading: true });
    loadPdf(url)
      .then((pdf) => {
        if (!alive) {
          pdf.destroy();
          return;
        }
        handle = pdf;
        setState({ pdf, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : 'failed to load PDF';
        setState({ pdf: null, error: msg, loading: false });
      });
    return () => {
      alive = false;
      if (handle) handle.destroy();
    };
  }, [url]);

  return state;
}
