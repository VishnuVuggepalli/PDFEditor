/** Engine page operations shared by the mupdf worker and the node-side
 * parity harness. Everything here is DOM-free: callers pass the loaded
 * mupdf module + page, so the exact code the worker executes per request
 * is also what the parity corpus exercises headless.
 */

import type * as MU from 'mupdf';
import type { PageInfoResult, StextLine } from './mupdfProtocol';
import { displayMatrix, rgbToRgba, stextLines, type Mat, type StextJson } from './mupdfTransforms';

type Mupdf = typeof MU;

/** Read the page's CropBox (fallback MediaBox) as a normalized viewBox. */
export function readViewBox(obj: MU.PDFObject): [number, number, number, number] | null {
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

/** Everything the main-thread page facade needs to do geometry. */
export function readPageInfo(page: MU.PDFPage): PageInfoResult {
  const b = page.getBounds();
  const obj = page.getObject();
  const rotate = obj.getInheritable('Rotate');
  const baseRotation = rotate.isNumber() ? ((rotate.asNumber() % 360) + 360) % 360 : 0;
  return {
    baseRotation,
    viewBox: readViewBox(obj) ?? [0, 0, b[2] - b[0], b[3] - b[1]],
    bounds: [b[0], b[1], b[2], b[3]],
    pageTransform: page.getTransform() as Mat,
  };
}

export interface RgbaRender {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Rasterize a page exactly as the worker 'render' op does: fitz page space
 * (intrinsic /Rotate already applied) -> extra rotation -> scale -> RGBA. */
export function renderPageRgba(
  mu: Mupdf,
  page: MU.PDFPage,
  scale: number,
  extraRotation: number,
): RgbaRender {
  const m = displayMatrix(scale, extraRotation);
  const pix = page.toPixmap(m as MU.Matrix, mu.ColorSpace.DeviceRGB, false, true);
  try {
    const width = pix.getWidth();
    const height = pix.getHeight();
    return { pixels: rgbToRgba(pix.getPixels(), width, height, pix.getStride()), width, height };
  } finally {
    pix.destroy();
  }
}

/** Structured-text lines exactly as the worker 'textLines' op returns them. */
export function readTextLines(page: MU.PDFPage): StextLine[] {
  const st = page.toStructuredText('preserve-spans');
  try {
    return stextLines(JSON.parse(st.asJSON()) as StextJson);
  } finally {
    st.destroy();
  }
}
