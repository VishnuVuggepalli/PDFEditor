/** mupdf-WASM rendering engine. Implements the same PageHandle/PdfHandle
 * surface as the pdf.js engine plus the in-place text-edit capability.
 * The wasm module is imported lazily so the default (pdfjs) bundle never
 * downloads it. ALL mupdf imports stay inside src/pdf/. */

import type * as MU from 'mupdf';
import type { PageHandle, PdfEditCapable, TextSpanInfo } from './engineApi';
import type { PdfRect, ViewportParams } from './coords';
import { viewportSize } from './coords';
import {
  approxBaseline,
  base14FontName,
  buildEditContentStream,
  displayMatrix,
  displayOrigin,
  matInvert,
  rgbToRgba,
  transformPoint,
  transformRect,
  type Mat,
} from './mupdfTransforms';

type Mupdf = typeof MU;

let mupdfModule: Promise<Mupdf> | null = null;

/** Lazy singleton import of the wasm module (~9.6 MB uncompressed). */
function loadMupdf(): Promise<Mupdf> {
  mupdfModule ??= import('mupdf');
  return mupdfModule;
}

/* ---- structured text JSON shape (subset we consume) ---- */

interface StextFont {
  name: string;
  family: string;
  weight: string;
  style: string;
  size: number;
}

interface StextLine {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  font: StextFont;
}

interface StextBlock {
  type: string;
  lines?: StextLine[];
}

interface StextJson {
  blocks?: StextBlock[];
}

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
  /** page bounds in fitz display space (y down, /Rotate applied) */
  private readonly bounds: [number, number, number, number];
  /** PDF user space -> fitz display space */
  private readonly pageTransform: Mat;
  private readonly mu: Mupdf;
  readonly raw: MU.PDFPage;
  private stextCache: StextJson | null = null;

  constructor(mu: Mupdf, page: MU.PDFPage, n: number) {
    this.mu = mu;
    this.raw = page;
    this.n = n;
    const b = page.getBounds();
    this.bounds = [b[0], b[1], b[2], b[3]];
    this.pageTransform = page.getTransform() as Mat;
    const obj = page.getObject();
    const rotate = obj.getInheritable('Rotate');
    this.baseRotation = rotate.isNumber() ? ((rotate.asNumber() % 360) + 360) % 360 : 0;
    this.viewBox = readViewBox(obj) ?? [0, 0, b[2] - b[0], b[3] - b[1]];
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
    // fitz page space already includes /Rotate; only the pending delta rotates.
    const m = displayMatrix(scale * dpr, extraRotation);
    const pix = this.raw.toPixmap(m as MU.Matrix, this.mu.ColorSpace.DeviceRGB, false, true);
    try {
      const w = pix.getWidth();
      const h = pix.getHeight();
      const rgba = rgbToRgba(pix.getPixels(), w, h, pix.getStride());
      const css = viewportSize(this.viewportParams(scale, extraRotation));
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${css.width}px`;
      canvas.style.height = `${css.height}px`;
      ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
    } finally {
      pix.destroy();
    }
  }

  private stext(): StextJson {
    if (!this.stextCache) {
      const st = this.raw.toStructuredText('preserve-spans');
      try {
        this.stextCache = JSON.parse(st.asJSON()) as StextJson;
      } finally {
        st.destroy();
      }
    }
    return this.stextCache;
  }

  private lines(): StextLine[] {
    const out: StextLine[] = [];
    for (const block of this.stext().blocks ?? []) {
      if (block.type !== 'text' || !block.lines) continue;
      for (const line of block.lines) out.push(line);
    }
    return out;
  }

  async renderTextLayer(container: HTMLDivElement, scale: number, extraRotation = 0): Promise<void> {
    container.replaceChildren();
    container.style.setProperty('--scale-factor', String(scale));
    const m = displayMatrix(scale, extraRotation);
    const [ox, oy] = displayOrigin(this.bounds, m);
    const rot = ((extraRotation % 360) + 360) % 360;
    for (const line of this.lines()) {
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
    return this.lines()
      .map((l) => l.text)
      .join(' ')
      .replace(/\s+/g, ' ');
  }

  /** Find the text line under a PDF user-space point (y-up). */
  spanAt(x: number, y: number): TextSpanInfo | null {
    const [fx, fy] = transformPoint(this.pageTransform, x, y);
    for (const line of this.lines()) {
      const b = line.bbox;
      if (fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h) {
        const fitzBox: [number, number, number, number] = [b.x, b.y, b.x + b.w, b.y + b.h];
        const inv = matInvert(this.pageTransform);
        const pdfBox = transformRect(inv, fitzBox);
        return {
          page: this.n,
          text: line.text,
          bbox: pdfBox as PdfRect,
          fitzBox,
          fontName: line.font.name,
          fontFamily: line.font.family,
          fontSize: line.font.size,
        };
      }
    }
    return null;
  }

  /** Drop cached structured text (after an edit mutated the page). */
  invalidate(): void {
    this.stextCache = null;
  }

  destroy(): void {
    this.raw.destroy();
  }
}

/** Read the page's CropBox (fallback MediaBox) as a normalized viewBox. */
function readViewBox(obj: MU.PDFObject): [number, number, number, number] | null {
  for (const key of ['CropBox', 'MediaBox']) {
    const box = obj.getInheritable(key);
    if (box.isArray() && box.length === 4) {
      const v = [0, 1, 2, 3].map((i) => box.get(i).asNumber());
      return [
        Math.min(v[0], v[2]),
        Math.min(v[1], v[3]),
        Math.max(v[0], v[2]),
        Math.max(v[1], v[3]),
      ];
    }
  }
  return null;
}

class MupdfPdf implements PdfEditCapable {
  readonly editsText = true as const;
  readonly pageCount: number;
  private readonly mu: Mupdf;
  private readonly doc: MU.PDFDocument;
  private readonly pages = new Map<number, MupdfPage>();
  private destroyed = false;

  constructor(mu: Mupdf, doc: MU.PDFDocument) {
    this.mu = mu;
    this.doc = doc;
    this.pageCount = doc.countPages();
  }

  async page(n: number): Promise<PageHandle> {
    return this.pageImpl(n);
  }

  private pageImpl(n: number): MupdfPage {
    if (this.destroyed) throw new Error('document destroyed');
    if (n < 1 || n > this.pageCount) throw new Error(`page ${n} out of range`);
    let p = this.pages.get(n);
    if (!p) {
      p = new MupdfPage(this.mu, this.doc.loadPage(n - 1), n);
      this.pages.set(n, p);
    }
    return p;
  }

  async textSpanAt(page: number, x: number, y: number): Promise<TextSpanInfo | null> {
    return this.pageImpl(page).spanAt(x, y);
  }

  /** Minimal viable in-place edit: redact the span's region (true content
   * removal), then draw the replacement text via an appended content stream.
   * Returns the complete edited PDF bytes for upload. */
  async replaceTextSpan(span: TextSpanInfo, newText: string): Promise<Uint8Array> {
    const pageWrap = this.pageImpl(span.page);
    const page = pageWrap.raw;
    const doc = this.doc;

    const annot = page.createAnnotation('Redact');
    annot.setRect(span.fitzBox);
    page.applyRedactions(
      false,
      this.mu.PDFPage.REDACT_IMAGE_NONE,
      this.mu.PDFPage.REDACT_LINE_ART_NONE,
      this.mu.PDFPage.REDACT_TEXT_REMOVE,
    );

    if (newText.trim().length > 0) {
      const fontName = base14FontName(span.fontFamily, 'normal', 'normal');
      const fontRef = doc.addSimpleFont(new this.mu.Font(fontName));
      const pageObj = page.getObject();
      let res = pageObj.get('Resources');
      if (!res.isDictionary()) {
        res = doc.newDictionary();
        pageObj.put('Resources', res);
      }
      let fonts = res.get('Font');
      if (!fonts.isDictionary()) {
        fonts = doc.newDictionary();
        res.put('Font', fonts);
      }
      let resName = 'FzEdit';
      for (let i = 0; !fonts.get(resName).isNull(); i++) resName = `FzEdit${i}`;
      fonts.put(resName, fontRef);

      const baseline = approxBaseline(span.bbox[1], span.fontSize);
      const fragment = buildEditContentStream(resName, span.fontSize, span.bbox[0], baseline, newText);
      const extra = doc.addStream(fragment, {});
      const contents = pageObj.get('Contents');
      if (contents.isArray()) {
        contents.push(extra);
      } else {
        const arr = doc.newArray();
        arr.push(contents);
        arr.push(extra);
        pageObj.put('Contents', arr);
      }
    }

    pageWrap.invalidate();
    const buf = doc.saveToBuffer('garbage,compress');
    try {
      return buf.asUint8Array().slice();
    } finally {
      buf.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const p of this.pages.values()) p.destroy();
    this.pages.clear();
    this.doc.destroy();
  }
}

/** Load a PDF from a URL with the mupdf engine. */
export async function loadPdfMupdf(url: string): Promise<PdfEditCapable> {
  const [mu, resp] = await Promise.all([loadMupdf(), fetch(url)]);
  if (!resp.ok) throw new Error(`fetch pdf failed: ${resp.status}`);
  const bytes = await resp.arrayBuffer();
  const doc = mu.Document.openDocument(bytes, 'application/pdf');
  const pdf = doc.asPDF();
  if (!pdf) {
    doc.destroy();
    throw new Error('not a PDF document');
  }
  return new MupdfPdf(mu, pdf);
}
