/** Pure helpers for the Sign tool: placement geometry, stroke mapping and
 * data-URL handling. No DOM access — unit-testable.
 *
 * Placement is computed in VIEWPORT space (px, y down) and converted to PDF
 * points by the caller via coords.ts — this keeps signatures visually
 * upright on rotated pages, exactly like hand-drawn ink. */

import type { ViewportRect } from '../pdf/coords';

/** Default placed signature width in PDF points (~29% of a letter page);
 * multiply by the viewport scale for the on-screen width. */
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

/** A cryptographic signing request from the Digital tab. The actual signing
 * happens server-side with the installation's certificate. */
export interface DigitalSignature {
  readonly kind: 'digital';
  readonly reason: string;
  readonly location: string;
  /** place a visible signature widget (signer name + date) at the click */
  readonly visible: boolean;
}

export type SignaturePayload = DrawnSignature | ImageSignature | DigitalSignature;

/** Aspect ratio (height / width) of the visible digital-signature widget. */
export const DIGITAL_SIGN_ASPECT = 0.32;

/** Badge descriptor for one signature validation report. */
export interface SignatureBadge {
  /** visual tone, mapping to existing badge styles */
  tone: 'green' | 'amber' | 'danger';
  label: string;
}

/** Map a signature validation status onto a UI badge. "unknown" is the
 * expected status for documents signed by an identity outside the local
 * trust store: the content is intact but the signer cannot be verified. */
export function signatureBadge(sig: {
  status: 'valid' | 'invalid' | 'unknown';
  signer: string;
}): SignatureBadge {
  const who = sig.signer || 'Unknown';
  switch (sig.status) {
    case 'valid':
      return { tone: 'green', label: `Valid — ${who}` };
    case 'invalid':
      return { tone: 'danger', label: `Invalid — ${who}` };
    default:
      return { tone: 'amber', label: `Unknown signer — ${who}` };
  }
}

/** Compute the placement rect (viewport px, top-left origin) for a
 * signature centered on the clicked point, clamped inside the page. */
export function placementRect(
  at: readonly [number, number],
  page: { width: number; height: number },
  aspect: number,
  targetW: number,
): ViewportRect {
  const w = Math.min(targetW, page.width * 0.9);
  const h = Math.min(w * aspect, page.height * 0.9);
  const x = Math.max(0, Math.min(page.width - w, at[0] - w / 2));
  const y = Math.max(0, Math.min(page.height - h, at[1] - h / 2));
  return { x, y, w, h };
}

/** Map pad-normalized strokes (0..1, y down) into a viewport rect (also
 * y down), producing per-stroke point lists. Single-point strokes are
 * dropped (the backend requires at least two points per ink path). */
export function strokesToViewportPaths(
  strokes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  rect: ViewportRect,
): [number, number][][] {
  return strokes
    .filter((s) => s.length >= 2)
    .map((s) => s.map(([nx, ny]): [number, number] => [rect.x + nx * rect.w, rect.y + ny * rect.h]));
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
