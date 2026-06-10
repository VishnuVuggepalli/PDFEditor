/** Pure placement math for the inline text-edit overlay: where (and how
 * rotated) a contenteditable box must sit so it covers a text line's PDF
 * bbox in viewport coordinates, for any zoom and 90-degree rotation. */

import type { PdfRect, ViewportParams } from './coords';
import { pdfRectToViewport } from './coords';

export interface OverlayPlacement {
  /** CSS left/top of the (unrotated) box inside the page element, px */
  left: number;
  top: number;
  /** size of the box along the text's own axes (width = reading direction) */
  width: number;
  height: number;
  /** CSS rotation to apply with transform-origin 0 0 */
  angle: 0 | 90 | 180 | 270;
  /** font size matching the rendered glyph height at this zoom, px */
  fontPx: number;
}

/** Compute the overlay box for a line bbox (PDF points, y-up) under the
 * given viewport. The box keeps the line's own width/height and is rotated
 * about its CSS top-left corner; left/top are chosen so the rotated box
 * lands exactly on the viewport-space rectangle of the bbox. */
export function overlayPlacement(
  bbox: PdfRect,
  fontSize: number,
  vp: ViewportParams,
): OverlayPlacement {
  const r = pdfRectToViewport(bbox, vp);
  const width = (bbox[2] - bbox[0]) * vp.scale;
  const height = (bbox[3] - bbox[1]) * vp.scale;
  const angle = ((((vp.rotation % 360) + 360) % 360) as 0 | 90 | 180 | 270);
  // With transform-origin 0 0, rotate(a) maps the box [0,w]x[0,h] to a
  // quadrant around the anchor; pick the anchor that puts the image on r.
  let left = r.x;
  let top = r.y;
  if (angle === 90) {
    left = r.x + r.w; // box image spans x in [-h, 0]
  } else if (angle === 180) {
    left = r.x + r.w; // box image spans [-w, 0] x [-h, 0]
    top = r.y + r.h;
  } else if (angle === 270) {
    top = r.y + r.h; // box image spans y in [-w, 0]
  }
  return { left, top, width, height, angle, fontPx: fontSize * vp.scale };
}

/** Normalize contenteditable output to the single-line model the redact+
 * redraw edit supports: newlines and runs of whitespace become one space. */
export function normalizeEditedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
