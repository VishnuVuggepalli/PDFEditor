/** Pure viewport ⇄ PDF coordinate math (page viewBox + rotation + scale).
 * Mirrors pdf.js PageViewport's transform so it can be unit-tested without
 * pdf.js. Viewport origin: top-left, y down. PDF origin: lower-left, y up. */

export interface ViewportParams {
  /** total rotation in degrees (page /Rotate + pending delta), 0/90/180/270 */
  rotation: number;
  scale: number;
  /** PDF page viewBox: [x0, y0, x1, y1] in PDF points */
  viewBox: [number, number, number, number];
}

export interface ViewportRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** PDF rect [llx, lly, urx, ury] in points, lower-left origin. */
export type PdfRect = [number, number, number, number];

function normRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Pixel size of the viewport for the given params. */
export function viewportSize(vp: ViewportParams): { width: number; height: number } {
  const [x0, y0, x1, y1] = vp.viewBox;
  const w = (x1 - x0) * vp.scale;
  const h = (y1 - y0) * vp.scale;
  const r = normRotation(vp.rotation);
  return r === 90 || r === 270 ? { width: h, height: w } : { width: w, height: h };
}

/** Convert a viewport point (px, top-left origin) to PDF user space points. */
export function viewportToPdfPoint(vx: number, vy: number, vp: ViewportParams): [number, number] {
  const [x0, y0, x1, y1] = vp.viewBox;
  const s = vp.scale;
  switch (normRotation(vp.rotation)) {
    case 90:
      return [x0 + vy / s, y0 + vx / s];
    case 180:
      return [x1 - vx / s, y0 + vy / s];
    case 270:
      return [x1 - vy / s, y1 - vx / s];
    default:
      return [x0 + vx / s, y1 - vy / s];
  }
}

/** Convert a PDF user-space point to viewport pixels (top-left origin). */
export function pdfToViewportPoint(px: number, py: number, vp: ViewportParams): [number, number] {
  const [x0, y0, x1, y1] = vp.viewBox;
  const s = vp.scale;
  switch (normRotation(vp.rotation)) {
    case 90:
      return [(py - y0) * s, (px - x0) * s];
    case 180:
      return [(x1 - px) * s, (py - y0) * s];
    case 270:
      return [(y1 - py) * s, (x1 - px) * s];
    default:
      return [(px - x0) * s, (y1 - py) * s];
  }
}

/** Convert a viewport rectangle to a normalized PDF rect (llx<urx, lly<ury). */
export function viewportRectToPdf(rect: ViewportRect, vp: ViewportParams): PdfRect {
  const [ax, ay] = viewportToPdfPoint(rect.x, rect.y, vp);
  const [bx, by] = viewportToPdfPoint(rect.x + rect.w, rect.y + rect.h, vp);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** Convert a PDF rect back to a viewport rectangle. */
export function pdfRectToViewport(rect: PdfRect, vp: ViewportParams): ViewportRect {
  const [ax, ay] = pdfToViewportPoint(rect[0], rect[1], vp);
  const [bx, by] = pdfToViewportPoint(rect[2], rect[3], vp);
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Convert a viewport polyline to a flat PDF-points path [x1,y1,x2,y2,...]. */
export function viewportPathToPdf(
  points: ReadonlyArray<readonly [number, number]>,
  vp: ViewportParams,
): number[] {
  const out: number[] = [];
  for (const [vx, vy] of points) {
    const [px, py] = viewportToPdfPoint(vx, vy, vp);
    out.push(px, py);
  }
  return out;
}

/** Convert a flat PDF path back to viewport points. */
export function pdfPathToViewport(flat: ReadonlyArray<number>, vp: ViewportParams): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push(pdfToViewportPoint(flat[i], flat[i + 1], vp));
  }
  return out;
}
