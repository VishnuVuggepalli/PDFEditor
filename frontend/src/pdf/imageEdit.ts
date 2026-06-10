/** Pure math + validation for in-place image editing (mupdf engine): image
 * hit-testing, aspect-fit placement, the insertion content-stream fragment,
 * file-type sniffing, and the selection box drag/resize geometry. No DOM,
 * no wasm — everything here is unit-testable in plain node/jsdom. */

import type { PdfRect, ViewportRect } from './coords';
import type { PageImageInfo } from './mupdfProtocol';

/** Hit-test a fitz display-space point against located images. The topmost
 * paint wins: images are listed in paint order, so scan from the end. */
export function imageAtPoint(
  images: readonly PageImageInfo[],
  fx: number,
  fy: number,
): PageImageInfo | null {
  for (let i = images.length - 1; i >= 0; i--) {
    const [x0, y0, x1, y1] = images[i].fitzBox;
    if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) return images[i];
  }
  return null;
}

/** Largest aspect-preserving placement of a srcW x srcH image centered
 * inside the target rect. Degenerate inputs collapse to the target rect. */
export function fitRectWithin(srcW: number, srcH: number, target: PdfRect): PdfRect {
  const tw = target[2] - target[0];
  const th = target[3] - target[1];
  if (!(srcW > 0) || !(srcH > 0) || !(tw > 0) || !(th > 0)) {
    return [target[0], target[1], target[2], target[3]];
  }
  const s = Math.min(tw / srcW, th / srcH);
  const w = srcW * s;
  const h = srcH * s;
  const x0 = target[0] + (tw - w) / 2;
  const y0 = target[1] + (th - h) / 2;
  return [x0, y0, x0 + w, y0 + h];
}

/** Content-stream fragment painting an image XObject into a PDF rect: the
 * cm matrix maps the image unit square onto the (axis-aligned) rect. */
export function buildImageContentStream(resName: string, rect: PdfRect): string {
  const w = (rect[2] - rect[0]).toFixed(2);
  const h = (rect[3] - rect[1]).toFixed(2);
  const x = rect[0].toFixed(2);
  const y = rect[1].toFixed(2);
  return `\nq ${w} 0 0 ${h} ${x} ${y} cm /${resName} Do Q\n`;
}

/* ---- replacement file validation (picker boundary) ---- */

export type ImageFileKind = 'png' | 'jpeg';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Identify a replacement image by its magic bytes; never trust the file
 * extension or MIME type the picker reports. */
export function sniffImageFile(bytes: Uint8Array): ImageFileKind | null {
  if (bytes.length >= PNG_SIG.length && PNG_SIG.every((b, i) => bytes[i] === b)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  return null;
}

/* ---- selection box geometry (viewport px, y down) ---- */

export type RectCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface PageSize {
  width: number;
  height: number;
}

/** Minimum selection box edge in viewport px while resizing. */
export const MIN_BOX_PX = 12;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Translate the box by (dx, dy), clamped so it stays fully on the page. */
export function moveRect(start: ViewportRect, dx: number, dy: number, page: PageSize): ViewportRect {
  return {
    x: clamp(start.x + dx, 0, Math.max(0, page.width - start.w)),
    y: clamp(start.y + dy, 0, Math.max(0, page.height - start.h)),
    w: start.w,
    h: start.h,
  };
}

/** Drag one corner by (dx, dy): the two adjacent edges move, the opposite
 * edges stay put. Clamped to the page and to a minimum box size. */
export function resizeRect(
  start: ViewportRect,
  corner: RectCorner,
  dx: number,
  dy: number,
  page: PageSize,
  min = MIN_BOX_PX,
): ViewportRect {
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  if (corner === 'nw' || corner === 'sw') x0 = clamp(x0 + dx, 0, x1 - min);
  else x1 = clamp(x1 + dx, x0 + min, page.width);
  if (corner === 'nw' || corner === 'ne') y0 = clamp(y0 + dy, 0, y1 - min);
  else y1 = clamp(y1 + dy, y0 + min, page.height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Whether two viewport rects coincide within eps px (Apply gating: no
 * geometry change means nothing to apply). */
export function rectsAlmostEqual(a: ViewportRect, b: ViewportRect, eps = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.w - b.w) <= eps &&
    Math.abs(a.h - b.h) <= eps
  );
}
