/** Thin wrapper around pdfjs-dist. ALL pdf.js imports stay inside src/pdf/
 * so the rendering engine can be swapped later. */

import { getDocument, TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { ensureWorker } from './worker';
import type { ViewportParams } from './coords';

export interface PageHandle {
  /** 1-based page number */
  readonly n: number;
  /** the page's intrinsic /Rotate in degrees */
  readonly baseRotation: number;
  /** unscaled [x0,y0,x1,y1] viewBox in PDF points */
  readonly viewBox: [number, number, number, number];
  /** width/height in px of the unrotated, unscaled page */
  baseSize(extraRotation?: number): { width: number; height: number };
  viewportParams(scale: number, extraRotation?: number): ViewportParams;
  render(canvas: HTMLCanvasElement, scale: number, extraRotation?: number): Promise<void>;
  renderTextLayer(
    container: HTMLDivElement,
    scale: number,
    extraRotation?: number,
  ): Promise<void>;
  text(): Promise<string>;
}

export interface PdfHandle {
  readonly pageCount: number;
  page(n: number): Promise<PageHandle>;
  destroy(): void;
}

class Page implements PageHandle {
  readonly n: number;
  readonly baseRotation: number;
  readonly viewBox: [number, number, number, number];
  private readonly proxy: PDFPageProxy;
  private renderTask: ReturnType<PDFPageProxy['render']> | null = null;

  constructor(proxy: PDFPageProxy) {
    this.proxy = proxy;
    this.n = proxy.pageNumber;
    this.baseRotation = proxy.rotate;
    const vb = proxy.view;
    this.viewBox = [vb[0], vb[1], vb[2], vb[3]];
  }

  private totalRotation(extra: number): number {
    return (((this.baseRotation + extra) % 360) + 360) % 360;
  }

  baseSize(extraRotation = 0): { width: number; height: number } {
    const vp = this.proxy.getViewport({ scale: 1, rotation: this.totalRotation(extraRotation) });
    return { width: vp.width, height: vp.height };
  }

  viewportParams(scale: number, extraRotation = 0): ViewportParams {
    return { rotation: this.totalRotation(extraRotation), scale, viewBox: this.viewBox };
  }

  async render(canvas: HTMLCanvasElement, scale: number, extraRotation = 0): Promise<void> {
    const viewport = this.proxy.getViewport({
      scale,
      rotation: this.totalRotation(extraRotation),
    });
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    if (this.renderTask) this.renderTask.cancel();
    const task = this.proxy.render({
      canvasContext: ctx,
      viewport,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch (e) {
      // Cancellations are routine when re-rendering at a new zoom level.
      if (e instanceof Error && e.name === 'RenderingCancelledException') return;
      throw e;
    } finally {
      if (this.renderTask === task) this.renderTask = null;
    }
  }

  async renderTextLayer(
    container: HTMLDivElement,
    scale: number,
    extraRotation = 0,
  ): Promise<void> {
    const viewport = this.proxy.getViewport({
      scale,
      rotation: this.totalRotation(extraRotation),
    });
    container.replaceChildren();
    container.style.setProperty('--scale-factor', String(scale));
    const layer = new TextLayer({
      textContentSource: this.proxy.streamTextContent(),
      container,
      viewport,
    });
    await layer.render();
  }

  async text(): Promise<string> {
    const content = await this.proxy.getTextContent();
    return content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ');
  }
}

class Pdf implements PdfHandle {
  readonly pageCount: number;
  private readonly proxy: PDFDocumentProxy;
  private readonly pages = new Map<number, Promise<PageHandle>>();

  constructor(proxy: PDFDocumentProxy) {
    this.proxy = proxy;
    this.pageCount = proxy.numPages;
  }

  page(n: number): Promise<PageHandle> {
    let p = this.pages.get(n);
    if (!p) {
      p = this.proxy.getPage(n).then((proxy) => new Page(proxy));
      this.pages.set(n, p);
    }
    return p;
  }

  destroy(): void {
    void this.proxy.destroy();
  }
}

/** Load a PDF from a URL (the API endpoints stream raw PDF bytes). */
export async function loadPdf(url: string): Promise<PdfHandle> {
  ensureWorker();
  const doc = await getDocument({ url }).promise;
  return new Pdf(doc);
}
