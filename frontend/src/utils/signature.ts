/** Pure helpers for the Sign tool: placement geometry, stroke mapping and
 * data-URL handling. No DOM access — unit-testable. */

import type { PdfRect } from '../pdf/coords';

/** Default placed signature width in PDF points (~29% of a letter page). */
export const SIGN_DEFAULT_W = 170;

/** A signature drawn on the pad: strokes normalized to 0..1 of the pad,
 * y pointing down (screen convention). */
export interface DrawnSignature {
  readonly kind: 'draw';
  readonly strokes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** pad aspect ratio: height / width */
  readonly aspect: number;
  readonly color: string;
}

/** An uploaded signature image. */
export interface ImageSignature {
  readonly kind: 'image';
  readonly dataUrl: string;
  /** natural image aspect ratio: height / width */
  readonly aspect: number;
}

export type SignaturePayload = DrawnSignature | ImageSignature;

/** Compute the placement rect (PDF points, lower-left origin) for a
 * signature centered on the clicked point, clamped inside the page box. */
export function placementRect(
  at: readonly [number, number],
  viewBox: readonly [number, number, number, number],
  aspect: number,
  targetW: number = SIGN_DEFAULT_W,
): PdfRect {
  const [x0, y0, x1, y1] = viewBox;
  const pageW = x1 - x0;
  const pageH = y1 - y0;
  const w = Math.min(targetW, pageW * 0.9);
  const h = Math.min(w * aspect, pageH * 0.9);
  const llx = Math.max(x0, Math.min(x1 - w, at[0] - w / 2));
  const lly = Math.max(y0, Math.min(y1 - h, at[1] - h / 2));
  return [llx, lly, llx + w, lly + h];
}

/** Map pad-normalized strokes (0..1, y down) into a PDF rect (y up),
 * producing flat [x1,y1,x2,y2,...] ink paths. Single-point strokes are
 * dropped (the backend requires at least two points per path). */
export function strokesToPdfPaths(
  strokes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  rect: PdfRect,
): number[][] {
  const [llx, lly, urx, ury] = rect;
  const w = urx - llx;
  const h = ury - lly;
  return strokes
    .filter((s) => s.length >= 2)
    .map((s) => {
      const flat: number[] = [];
      for (const [nx, ny] of s) {
        flat.push(llx + nx * w, ury - ny * h);
      }
      return flat;
    });
}

/** Decode a data: URL into a Blob (for multipart upload). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mimeMatch = /^data:([^;,]+)/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const isBase64 = header.includes(';base64');
  const body = dataUrl.slice(comma + 1);
  if (!isBase64) {
    return new Blob([decodeURIComponent(body)], { type: mime });
  }
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Max signature image upload size (mirrors the backend's 5 MB cap). */
export const MAX_SIGNATURE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Validate an uploaded signature image file. Returns an error message for
 * the user, or null when the file is acceptable. */
export function validateSignatureFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    return 'Signature image must be a PNG or JPEG.';
  }
  if (file.size > MAX_SIGNATURE_IMAGE_BYTES) {
    return 'Signature image must be 5 MB or smaller.';
  }
  if (file.size === 0) {
    return 'Signature image is empty.';
  }
  return null;
}
