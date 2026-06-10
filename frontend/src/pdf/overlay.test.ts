/** Overlay placement math: the rotated box must land exactly on the
 * viewport-space rectangle of the line bbox for every 90-degree rotation
 * and zoom. Fixture: A4 page, line bbox [72,714,272,746] (fitz y 96..128),
 * font size 24. */
import { describe, expect, it } from 'vitest';
import type { PdfRect, ViewportParams } from './coords';
import { pdfRectToViewport } from './coords';
import { normalizeEditedText, overlayPlacement } from './overlay';

const BBOX: PdfRect = [72, 714, 272, 746];
const VIEWBOX: [number, number, number, number] = [0, 0, 595, 842];

function vp(rotation: number, scale: number): ViewportParams {
  return { rotation, scale, viewBox: VIEWBOX };
}

/** Apply the CSS mapping (translate to left/top, rotate about 0 0) to a box
 * corner and return the axis-aligned bounds of the box image. */
function cssImage(p: ReturnType<typeof overlayPlacement>): { x: number; y: number; w: number; h: number } {
  const rad = (p.angle * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  const corners = [
    [0, 0],
    [p.width, 0],
    [0, p.height],
    [p.width, p.height],
  ].map(([x, y]) => [p.left + x * cos - y * sin, p.top + x * sin + y * cos]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

describe('overlayPlacement', () => {
  it('covers the line at rotation 0', () => {
    const p = overlayPlacement(BBOX, 24, vp(0, 1));
    expect(p).toEqual({ left: 72, top: 96, width: 200, height: 32, angle: 0, fontPx: 24 });
  });

  it('scales position, size and font with zoom', () => {
    const p = overlayPlacement(BBOX, 24, vp(0, 2));
    expect(p).toEqual({ left: 144, top: 192, width: 400, height: 64, angle: 0, fontPx: 48 });
  });

  it.each([90, 180, 270] as const)('rotated box lands on the viewport rect (%d deg)', (rot) => {
    const params = vp(rot, 1.5);
    const p = overlayPlacement(BBOX, 24, params);
    expect(p.angle).toBe(rot);
    // the box keeps the line's own axes
    expect(p.width).toBeCloseTo(300);
    expect(p.height).toBeCloseTo(48);
    expect(p.fontPx).toBeCloseTo(36);
    // and its CSS image is exactly the viewport rect of the bbox
    const want = pdfRectToViewport(BBOX, params);
    const got = cssImage(p);
    expect(got.x).toBeCloseTo(want.x);
    expect(got.y).toBeCloseTo(want.y);
    expect(got.w).toBeCloseTo(want.w);
    expect(got.h).toBeCloseTo(want.h);
  });

  it('normalizes negative rotations', () => {
    expect(overlayPlacement(BBOX, 24, vp(-90, 1)).angle).toBe(270);
  });
});

describe('normalizeEditedText', () => {
  it('collapses newlines and whitespace runs to single spaces', () => {
    expect(normalizeEditedText('  Hello\n  world  again ')).toBe('Hello world again');
    expect(normalizeEditedText('\n\n')).toBe('');
  });
});
