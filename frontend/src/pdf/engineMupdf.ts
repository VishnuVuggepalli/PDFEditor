/** mupdf engine facade. Implements the same PageHandle/PdfHandle surface as
 * the pdf.js engine plus the in-place text-edit capability. ALL wasm
 * execution lives in the shared mupdf worker (mupdfWorker.ts); this file
 * only does DOM work (canvas blits, text-layer spans) and pure geometry, so
 * the main thread never blocks on rasterization. */

import type { PageHandle, PdfEditCapable, TextSpanInfo } from './engineApi';
import type { PdfRect, ViewportParams } from './coords';
import { viewportSize } from './coords';
import {
  MupdfCancelledError,
  type MupdfRpc,
  type OpenResult,
  type PageInfoResult,
  type RenderResult,
  type ReplaceTextResult,
  type StextLine,
  type TextLinesResult,
} from './mupdfProtocol';
import { getMupdfRpc } from './mupdfWorkerClient';
import {
  displayMatrix,
  displayOrigin,
  lineAt,
  matInvert,
  transformPoint,
  transformRect,
} from './mupdfTransforms';

function cssFamily(family: string): string {
  return family === 'serif' || family === 'monospace' ? family : 'sans-serif';
}

/* ---- shared measuring canvas for text layer scaleX correction ---- */

let measureCtx: CanvasRenderingContext2D | null | undefined;

function measureWidth(text: string, fontPx: number, family: string): number | null {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return null;
  measureCtx.font = `${fontPx}px ${cssFamily(family)}`;
  const w = measureCtx.measureText(text).width;
  return Number.isFinite(w) && w > 0 ? w : null;
}

class MupdfPage implements PageHandle {
  readonly n: number;
  readonly baseRotation: number;
  readonly viewBox: [number, number, number, number];
  private readonly info: PageInfoResult;
  private readonly rpc: MupdfRpc;
  private readonly docId: number;
  private linesCache: Promise<StextLine[]> | null = null;
  /** In-flight render request id per target canvas. Page handles are cached
   * and shared (viewer + thumbnails render concurrently), so a single slot
   * would let one consumer cancel another's render — same semantics as the
   * pdf.js engine. */
  private readonly renderIds = new Map<HTMLCanvasElement, number>();

  constructor(rpc: MupdfRpc, docId: number, n: number, info: PageInfoResult) {
    this.rpc = rpc;
    this.docId = docId;
    this.n = n;
    this.info = info;
    this.baseRotation = info.baseRotation;
    this.viewBox = info.viewBox;
  }

  private totalRotation(extra: number): number {
    return (((this.baseRotation + extra) % 360) + 360) % 360;
  }

  baseSize(extraRotation = 0): { width: number; height: number } {
    return viewportSize(this.viewportParams(1, extraRotation));
  }

  viewportParams(scale: number, extraRotation = 0): ViewportParams {
    return { rotation: this.totalRotation(extraRotation), scale, viewBox: this.viewBox };
  }

  async render(canvas: HTMLCanvasElement, scale: number, extraRotation = 0): Promise<void> {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    const dpr = window.devicePixelRatio || 1;
    const prev = this.renderIds.get(canvas);
    if (prev !== undefined) this.rpc.cancel(prev);
    const { id, promise } = this.rpc.request<RenderResult>({
      op: 'render',
      docId: this.docId,
      page: this.n,
      scale: scale * dpr,
      extraRotation,
    });
    this.renderIds.set(canvas, id);
    try {
      const res = await promise;
      const css = viewportSize(this.viewportParams(scale, extraRotation));
      canvas.width = res.width;
      canvas.height = res.height;
      canvas.style.width = `${css.width}px`;
      canvas.style.height = `${css.height}px`;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(res.pixels), res.width, res.height), 0, 0);
    } catch (e) {
      // Superseded renders are routine when re-rendering at a new zoom level.
      if (e instanceof MupdfCancelledError) return;
      throw e;
    } finally {
      if (this.renderIds.get(canvas) === id) this.renderIds.delete(canvas);
    }
  }

  private lines(): Promise<StextLine[]> {
    this.linesCache ??= this.rpc
      .call<TextLinesResult>({ op: 'textLines', docId: this.docId, page: this.n })
      .then((r) => r.lines);
    return this.linesCache;
  }

  async renderTextLayer(container: HTMLDivElement, scale: number, extraRotation = 0): Promise<void> {
    const lines = await this.lines();
    container.replaceChildren();
    container.style.setProperty('--scale-factor', String(scale));
    const m = displayMatrix(scale, extraRotation);
    const [ox, oy] = displayOrigin(this.info.bounds, m);
    const rot = ((extraRotation % 360) + 360) % 360;
    for (const line of lines) {
      if (!line.text) continue;
      const span = document.createElement('span');
      span.textContent = line.text;
      // Anchor: image of the line's fitz top-left corner. With
      // transform-origin 0 0 and rotate(extra), the span box covers the
      // transformed line region for every 90-degree rotation.
      const [ax, ay] = transformPoint(m, line.bbox.x, line.bbox.y);
      span.style.left = `${ax - ox}px`;
      span.style.top = `${ay - oy}px`;
      const fontPx = line.font.size * scale;
      span.style.fontSize = `${fontPx}px`;
      span.style.fontFamily = cssFamily(line.font.family);
      const target = line.bbox.w * scale;
      const measured = measureWidth(line.text, fontPx, line.font.family);
      const sx = measured ? target / measured : 1;
      const parts: string[] = [];
      if (rot !== 0) parts.push(`rotate(${rot}deg)`);
      if (Math.abs(sx - 1) > 0.001) parts.push(`scaleX(${sx.toFixed(4)})`);
      if (parts.length) span.style.transform = parts.join(' ');
      container.appendChild(span);
    }
  }

  async text(): Promise<string> {
    return (await this.lines())
      .map((l) => l.text)
      .join(' ')
      .replace(/\s+/g, ' ');
  }

  /** Find the text line under a PDF user-space point (y-up). */
  async spanAt(x: number, y: number): Promise<TextSpanInfo | null> {
    const [fx, fy] = transformPoint(this.info.pageTransform, x, y);
    const line = lineAt(await this.lines(), fx, fy);
    if (!line) return null;
    const b = line.bbox;
    const fitzBox: [number, number, number, number] = [b.x, b.y, b.x + b.w, b.y + b.h];
    const pdfBox = transformRect(matInvert(this.info.pageTransform), fitzBox);
    return {
      page: this.n,
      text: line.text,
      bbox: pdfBox as PdfRect,
      fitzBox,
      fontName: line.font.name,
      fontFamily: line.font.family,
      fontWeight: line.font.weight,
      fontStyle: line.font.style,
      fontSize: line.font.size,
    };
  }

  /** Drop cached structured text (after an edit mutated the page). */
  invalidate(): void {
    this.linesCache = null;
  }
}

class MupdfPdf implements PdfEditCapable {
  readonly editsText = true as const;
  readonly pageCount: number;
  private readonly rpc: MupdfRpc;
  private readonly docId: number;
  private readonly pages = new Map<number, Promise<MupdfPage>>();
  private destroyed = false;

  constructor(rpc: MupdfRpc, opened: OpenResult) {
    this.rpc = rpc;
    this.docId = opened.docId;
    this.pageCount = opened.pageCount;
  }

  page(n: number): Promise<PageHandle> {
    return this.pageImpl(n);
  }

  private pageImpl(n: number): Promise<MupdfPage> {
    if (this.destroyed) return Promise.reject(new Error('document destroyed'));
    if (n < 1 || n > this.pageCount) {
      return Promise.reject(new Error(`page ${n} out of range`));
    }
    let p = this.pages.get(n);
    if (!p) {
      p = this.rpc
        .call<PageInfoResult>({ op: 'pageInfo', docId: this.docId, page: n })
        .then((info) => new MupdfPage(this.rpc, this.docId, n, info));
      this.pages.set(n, p);
    }
    return p;
  }

  async textSpanAt(page: number, x: number, y: number): Promise<TextSpanInfo | null> {
    return (await this.pageImpl(page)).spanAt(x, y);
  }

  /** Redact the span's region and draw newText in its place (in the worker);
   * returns the complete edited PDF bytes for upload. */
  async replaceTextSpan(span: TextSpanInfo, newText: string): Promise<Uint8Array> {
    const res = await this.rpc.call<ReplaceTextResult>({
      op: 'replaceText',
      docId: this.docId,
      span,
      newText,
    });
    if (res.font) {
      console.info(
        `[pdf-engine] text edit font: ${res.font.name} (${res.font.strategy})`,
        `original: ${span.fontName}`,
      );
    }
    // The page content changed inside the worker; drop stale text caches.
    const cached = this.pages.get(span.page);
    if (cached) void cached.then((p) => p.invalidate()).catch(() => undefined);
    return new Uint8Array(res.bytes);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pages.clear();
    // Fire-and-forget: frees wasm-side memory; the worker itself stays up
    // for the next document. Teardown errors (e.g. terminated worker on
    // pagehide) are irrelevant to the caller.
    void this.rpc.call({ op: 'close', docId: this.docId }).catch(() => undefined);
  }
}

/** Load a PDF from a URL with the mupdf engine. The bytes transfer into the
 * worker (no copy). `rpc` is injectable for tests; the default is the shared
 * worker-backed instance. */
export async function loadPdfMupdf(url: string, rpc?: MupdfRpc): Promise<PdfEditCapable> {
  const r = rpc ?? getMupdfRpc();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch pdf failed: ${resp.status}`);
  const bytes = await resp.arrayBuffer();
  const opened = await r.call<OpenResult>({ op: 'open', bytes }, [bytes]);
  return new MupdfPdf(r, opened);
}
