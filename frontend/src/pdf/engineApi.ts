/** Engine-neutral PDF rendering interface. Both engines (pdf.js and
 * mupdf-wasm) implement these shapes; components depend only on this file
 * plus coords.ts, never on a concrete engine. */

import type { PdfRect, ViewportParams } from './coords';

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

/** One editable run of text identified on a page (mupdf engine only). */
export interface TextSpanInfo {
  /** 1-based page number */
  page: number;
  text: string;
  /** [llx,lly,urx,ury] in PDF points, lower-left origin (coords.ts space) */
  bbox: PdfRect;
  /** [x0,y0,x1,y1] in fitz display space (y down), used for redaction */
  fitzBox: [number, number, number, number];
  fontName: string;
  /** stext-reported family: sans-serif | serif | monospace */
  fontFamily: string;
  /** stext-reported weight: normal | bold */
  fontWeight: string;
  /** stext-reported style: normal | italic */
  fontStyle: string;
  fontSize: number;
}

/** Optional in-place text-edit capability. Implemented by the mupdf engine;
 * absent from the pdf.js engine. */
export interface PdfEditCapable extends PdfHandle {
  readonly editsText: true;
  /** Find the text line under a PDF-space point (y-up), or null. */
  textSpanAt(page: number, x: number, y: number): Promise<TextSpanInfo | null>;
  /** Redact the span's area and draw newText in its place; returns the full
   * edited PDF bytes. The handle should be reloaded afterwards. */
  replaceTextSpan(span: TextSpanInfo, newText: string): Promise<Uint8Array>;
}

/** Type guard: does this handle support in-place text editing? */
export function canEditText(pdf: PdfHandle): pdf is PdfEditCapable {
  return (pdf as Partial<PdfEditCapable>).editsText === true;
}

/** One image paint selected on a page (mupdf engine only). */
export interface ImageSelection {
  /** 1-based page number */
  page: number;
  /** 0-based paint-order index of the image on its page */
  index: number;
  /** axis-aligned bbox [llx,lly,urx,ury] in PDF points (coords.ts space) */
  bbox: PdfRect;
  /** intrinsic pixel dimensions of the embedded image */
  width: number;
  height: number;
}

/** An image edit to apply in the worker. Rects are PDF points (y-up);
 * 'replace' aspect-fits the new image into the rect, 'transform' redraws
 * the original image into the (axis-aligned) rect. */
export type ImageEditRequest =
  | { kind: 'delete'; sel: ImageSelection }
  | { kind: 'replace'; sel: ImageSelection; bytes: Uint8Array; rect: PdfRect }
  | { kind: 'transform'; sel: ImageSelection; rect: PdfRect };

/** Optional in-place image-edit capability. Implemented by the mupdf
 * engine; absent from the pdf.js engine. */
export interface PdfImageEditCapable extends PdfHandle {
  readonly editsImages: true;
  /** Find the topmost image under a PDF-space point (y-up), or null. */
  imageAt(page: number, x: number, y: number): Promise<ImageSelection | null>;
  /** Apply an image edit; returns the full edited PDF bytes. The handle
   * should be reloaded afterwards. */
  applyImageEdit(edit: ImageEditRequest): Promise<Uint8Array>;
}

/** Type guard: does this handle support in-place image editing? */
export function canEditImages(pdf: PdfHandle): pdf is PdfImageEditCapable {
  return (pdf as Partial<PdfImageEditCapable>).editsImages === true;
}
