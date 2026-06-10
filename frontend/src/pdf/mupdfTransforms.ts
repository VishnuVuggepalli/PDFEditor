/** Pure math + string helpers for the mupdf engine. No wasm imports, so
 * everything here is unit-testable in plain jsdom/node. Matrix convention
 * matches fitz: [a,b,c,d,e,f], row-vector transforms, concat(A,B) = A then B. */

export type Mat = [number, number, number, number, number, number];

export const MAT_IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function matScale(s: number): Mat {
  return [s, 0, 0, s, 0, 0];
}

/** Exact rotation matrix for multiples of 90 degrees. */
export function matRotate(deg: number): Mat {
  switch (((deg % 360) + 360) % 360) {
    case 90:
      return [0, 1, -1, 0, 0, 0];
    case 180:
      return [-1, 0, 0, -1, 0, 0];
    case 270:
      return [0, -1, 1, 0, 0, 0];
    default:
      return MAT_IDENTITY;
  }
}

/** concat(A, B): apply A first, then B (fitz fz_concat semantics). */
export function matConcat(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/** Invert an affine matrix (assumes non-zero determinant). */
export function matInvert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}

export function transformPoint(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Transform an axis-aligned rect [x0,y0,x1,y1]; returns the bbox of the
 * transformed corners. */
export function transformRect(m: Mat, r: [number, number, number, number]): [number, number, number, number] {
  const pts = [
    transformPoint(m, r[0], r[1]),
    transformPoint(m, r[2], r[1]),
    transformPoint(m, r[0], r[3]),
    transformPoint(m, r[2], r[3]),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Matrix mapping fitz page space to display pixels: rotate by the pending
 * extra rotation, then scale. (The page's intrinsic /Rotate is already baked
 * into fitz page space.) */
export function displayMatrix(scale: number, extraRotation: number): Mat {
  return matConcat(matRotate(extraRotation), matScale(scale));
}

/** Top-left offset of the transformed page bounds; subtract from transformed
 * points to get canvas-local pixels (mirrors Pixmap getX/getY). */
export function displayOrigin(bounds: [number, number, number, number], m: Mat): [number, number] {
  const r = transformRect(m, bounds);
  return [r[0], r[1]];
}

/** Expand 3-component RGB pixmap samples to opaque RGBA for ImageData. */
export function rgbToRgba(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  stride: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    let s = y * stride;
    let d = y * width * 4;
    for (let x = 0; x < width; x++) {
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = 255;
      s += 3;
      d += 4;
    }
  }
  return out;
}

/** Escape a string for a PDF literal string token. Non Latin-1 characters are
 * replaced (simple-font WinAnsi encoding limit of the edit prototype). */
export function escapePdfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
    else if (code === 10) out += '\\n';
    else if (code === 13) out += '\\r';
    else if (code < 32 || code > 255) out += '?';
    else out += ch;
  }
  return out;
}

/** Map a structured-text font description to a base-14 font name. */
export function base14FontName(family: string, weight: string, style: string): string {
  const bold = weight === 'bold';
  const italic = style === 'italic';
  if (family === 'monospace') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  if (family === 'serif') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/** Content-stream fragment drawing replacement text at a baseline point in
 * PDF user space. fontRes is the resource name registered for the font. */
export function buildEditContentStream(
  fontRes: string,
  fontSize: number,
  x: number,
  y: number,
  text: string,
): string {
  const fs = fontSize.toFixed(2);
  const tx = x.toFixed(2);
  const ty = y.toFixed(2);
  return `\nq BT /${fontRes} ${fs} Tf 1 0 0 1 ${tx} ${ty} Tm (${escapePdfText(text)}) Tj ET Q\n`;
}

/** Approximate text baseline (PDF y-up) for a line bbox and font size: the
 * descender of common base-14 fonts is ~0.21 em above the bbox bottom. */
export function approxBaseline(lly: number, fontSize: number): number {
  return lly + 0.21 * fontSize;
}
