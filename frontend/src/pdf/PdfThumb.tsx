/** Small canvas thumbnail of one PDF page. Lives in src/pdf/ so components
 * never touch pdf.js directly. */

import { useEffect, useRef } from 'react';
import type { PdfHandle } from './engine';

interface Props {
  pdf: PdfHandle;
  page: number;
  /** target CSS width in px */
  width: number;
  /** pending extra rotation in degrees */
  rotation?: number;
}

export function PdfThumb({ pdf, page, width, rotation = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = await pdf.page(page);
        const base = p.baseSize(rotation);
        const canvas = canvasRef.current;
        if (!alive || !canvas) return;
        await p.render(canvas, width / base.width, rotation);
      } catch {
        // Thumbnail render failures are non-fatal (page may be gone).
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdf, page, width, rotation]);

  return <canvas ref={canvasRef} className="pdf-thumb-canvas" />;
}
