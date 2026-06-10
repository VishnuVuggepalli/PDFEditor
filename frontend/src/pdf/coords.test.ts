import { describe, expect, it } from 'vitest';
import {
  pdfRectToViewport,
  pdfToViewportPoint,
  viewportRectToPdf,
  viewportSize,
  viewportToPdfPoint,
} from './coords';
import type { ViewportParams } from './coords';

// US Letter: 612 x 792 pt, origin at 0,0
const letter = (rotation: number, scale = 1): ViewportParams => ({
  rotation,
  scale,
  viewBox: [0, 0, 612, 792],
});

describe('viewportSize', () => {
  it('swaps dimensions for 90/270 rotations', () => {
    expect(viewportSize(letter(0))).toEqual({ width: 612, height: 792 });
    expect(viewportSize(letter(90))).toEqual({ width: 792, height: 612 });
    expect(viewportSize(letter(180, 2))).toEqual({ width: 1224, height: 1584 });
    expect(viewportSize(letter(270))).toEqual({ width: 792, height: 612 });
  });
});

describe('viewportToPdfPoint', () => {
  it('flips the y axis at rotation 0', () => {
    // top-left of the viewport is the top-left of the page = PDF (0, 792)
    expect(viewportToPdfPoint(0, 0, letter(0))).toEqual([0, 792]);
    // bottom-right of the viewport = PDF (612, 0)
    expect(viewportToPdfPoint(612, 792, letter(0))).toEqual([612, 0]);
  });

  it('honours scale', () => {
    const vp = letter(0, 2);
    expect(viewportToPdfPoint(1224, 0, vp)).toEqual([612, 792]);
  });

  it('maps corners correctly under rotation 90', () => {
    // After a 90° cw rotation the PDF origin (0,0) lands at viewport top-left.
    expect(viewportToPdfPoint(0, 0, letter(90))).toEqual([0, 0]);
    expect(viewportToPdfPoint(792, 612, letter(90))).toEqual([612, 792]);
  });

  it('maps corners correctly under rotation 180 and 270', () => {
    expect(viewportToPdfPoint(0, 0, letter(180))).toEqual([612, 0]);
    expect(viewportToPdfPoint(612, 792, letter(180))).toEqual([0, 792]);
    expect(viewportToPdfPoint(0, 0, letter(270))).toEqual([612, 792]);
    expect(viewportToPdfPoint(792, 612, letter(270))).toEqual([0, 0]);
  });

  it('handles a non-zero viewBox origin', () => {
    const vp: ViewportParams = { rotation: 0, scale: 1, viewBox: [10, 20, 622, 812] };
    expect(viewportToPdfPoint(0, 0, vp)).toEqual([10, 812]);
    expect(viewportToPdfPoint(612, 792, vp)).toEqual([622, 20]);
  });
});

describe('round trips', () => {
  const cases: Array<[number, number]> = [
    [0, 1],
    [90, 1.5],
    [180, 0.75],
    [270, 2],
  ];
  for (const [rotation, scale] of cases) {
    it(`viewport→pdf→viewport is identity at rotation ${rotation}, scale ${scale}`, () => {
      const vp = letter(rotation, scale);
      const [px, py] = viewportToPdfPoint(123.5, 456.25, vp);
      const [vx, vy] = pdfToViewportPoint(px, py, vp);
      expect(vx).toBeCloseTo(123.5, 6);
      expect(vy).toBeCloseTo(456.25, 6);
    });
  }
});

describe('rect conversions', () => {
  it('produces a normalized PDF rect (llx<urx, lly<ury)', () => {
    const vp = letter(0, 1);
    // viewport rect near the top of the page
    const rect = viewportRectToPdf({ x: 100, y: 50, w: 200, h: 30 }, vp);
    expect(rect[0]).toBeLessThan(rect[2]);
    expect(rect[1]).toBeLessThan(rect[3]);
    expect(rect).toEqual([100, 712, 300, 742]);
  });

  it('stays normalized under rotation', () => {
    for (const r of [90, 180, 270]) {
      const rect = viewportRectToPdf({ x: 10, y: 10, w: 100, h: 40 }, letter(r));
      expect(rect[0]).toBeLessThan(rect[2]);
      expect(rect[1]).toBeLessThan(rect[3]);
    }
  });

  it('rect round trip preserves geometry', () => {
    const vp = letter(90, 1.25);
    const orig = { x: 40, y: 60, w: 120, h: 80 };
    const back = pdfRectToViewport(viewportRectToPdf(orig, vp), vp);
    expect(back.x).toBeCloseTo(orig.x, 6);
    expect(back.y).toBeCloseTo(orig.y, 6);
    expect(back.w).toBeCloseTo(orig.w, 6);
    expect(back.h).toBeCloseTo(orig.h, 6);
  });

  it('a highlight rect lands on the text it covers (worked example)', () => {
    // A line of text at PDF y 700..712, x 72..300 on an unrotated letter page
    // rendered at scale 1 appears at viewport y 80..92 (792-712 .. 792-700).
    const vp = letter(0, 1);
    const rect = viewportRectToPdf({ x: 72, y: 80, w: 228, h: 12 }, vp);
    expect(rect).toEqual([72, 700, 300, 712]);
  });
});
