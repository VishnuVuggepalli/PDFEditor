/** React hooks over the pdf engine. Components consume these instead of
 * importing pdfjs-dist directly. */

import { useEffect, useState } from 'react';
import { loadPdf } from './engineLoader';
import type { PdfHandle } from './engineApi';

export interface PdfDocState {
  pdf: PdfHandle | null;
  error: string | null;
  loading: boolean;
}

interface Loaded {
  url: string;
  pdf: PdfHandle | null;
  error: string | null;
}

/** Load (and own) a PdfHandle for the given URL. Destroys on URL change. */
export function usePdfDocument(url: string | null): PdfDocState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let handle: PdfHandle | null = null;
    loadPdf(url)
      .then((pdf) => {
        if (!alive) {
          pdf.destroy();
          return;
        }
        handle = pdf;
        setLoaded({ url, pdf, error: null });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : 'failed to load PDF';
        setLoaded({ url, pdf: null, error: msg });
      });
    return () => {
      alive = false;
      if (handle) handle.destroy();
    };
  }, [url]);

  if (!url) return { pdf: null, error: null, loading: false };
  if (!loaded || loaded.url !== url) return { pdf: null, error: null, loading: true };
  return { pdf: loaded.pdf, error: loaded.error, loading: false };
}
