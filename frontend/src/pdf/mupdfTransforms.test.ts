import { describe, expect, it } from 'vitest';
import {
  approxBaseline,
  base14FontName,
  buildEditContentStream,
  displayMatrix,
  displayOrigin,
  escapePdfText,
  matConcat,
  matInvert,
  matRotate,
  matScale,
  rgbToRgba,
  transformPoint,
  transformRect,
  type Mat,
} from './mupdfTransforms';

const A4: [number, number, number, number] = [0, 0, 595, 842];

describe('matrix helpers', () => {
  it('rotates points by exact 90-degree steps (fitz convention)', () => {
    expect(transformPoint(matRotate(0), 10, 20)).toEqual([10, 20]);
    expect(transformPoint(matRotate(90), 10, 20)).toEqual([-20, 10]);
    expect(transformPoint(matRotate(180), 10, 20)).toEqual([-10, -20]);
    expect(transformPoint(matRotate(270), 10, 20)).toEqual([20, -10]);
    expect(matRotate(-90)).toEqual(matRotate(270));
    expect(matRotate(450)).toEqual(matRotate(90));
  });

  it('concat applies left matrix first', () => {
    // scale then translate-ish via rotate: (1,0) -> scale2 (2,0) -> rot90 (0,2)
    const m = matConcat(matScale(2), matRotate(90));
    expect(transformPoint(m, 1, 0)).toEqual([0, 2]);
  });

  it('invert round-trips points', () => {
    const m: Mat = matConcat(matRotate(90), matScale(1.5));
    const inv = matInvert(m);
    const [x, y] = transformPoint(m, 12, 34);
    const [bx, by] = transformPoint(inv, x, y);
    expect(bx).toBeCloseTo(12);
    expect(by).toBeCloseTo(34);
  });

  it('inverts the standard page transform (y-flip) to itself', () => {
    const t: Mat = [1, 0, 0, -1, 0, 842];
    matInvert(t).forEach((v, i) => expect(v).toBeCloseTo(t[i]));
  });

  it('transformRect returns the bbox of transformed corners', () => {
    const m = displayMatrix(1, 90);
    expect(transformRect(m, [0, 0, 10, 20])).toEqual([-20, 0, 0, 10]);
  });
});

describe('displayOrigin', () => {
  // Expected values measured against real mupdf pixmaps (scripts/mupdf-coords.mjs):
  // rot 0: x=0 y=0; rot 90: x=-421 y=0; rot 180: x=-298 y=-421; rot 270: x=0 y=-298
  it.each([
    [0, 0, 0],
    [90, -421, 0],
    [180, -297.5, -421],
    [270, 0, -297.5],
  ])('matches real pixmap origin at rotation %d', (rot, ox, oy) => {
    const [x, y] = displayOrigin(A4, displayMatrix(0.5, rot));
    expect(x).toBeCloseTo(ox, 0);
    expect(y).toBeCloseTo(oy, 0);
  });
});

describe('rgbToRgba', () => {
  it('expands 3-component rows honoring stride and sets opaque alpha', () => {
    // 2x2 image with stride 8 (2 px * 3 + 2 padding bytes)
    const src = new Uint8Array([1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 0, 0]);
    const out = rgbToRgba(src, 2, 2, 8);
    expect(Array.from(out)).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255,
      7, 8, 9, 255, 10, 11, 12, 255,
    ]);
  });
});

describe('escapePdfText', () => {
  it('escapes PDF string delimiters and control characters', () => {
    expect(escapePdfText('a(b)c\\d')).toBe('a\\(b\\)c\\\\d');
    expect(escapePdfText('line1\nline2\r')).toBe('line1\\nline2\\r');
  });

  it('replaces non Latin-1 characters', () => {
    expect(escapePdfText('héllo 你')).toBe('héllo ?');
  });
});

describe('base14FontName', () => {
  it.each([
    ['sans-serif', 'normal', 'normal', 'Helvetica'],
    ['sans-serif', 'bold', 'italic', 'Helvetica-BoldOblique'],
    ['serif', 'normal', 'normal', 'Times-Roman'],
    ['serif', 'bold', 'normal', 'Times-Bold'],
    ['monospace', 'normal', 'italic', 'Courier-Oblique'],
    ['unknown', 'normal', 'normal', 'Helvetica'],
  ])('%s/%s/%s -> %s', (family, weight, style, expected) => {
    expect(base14FontName(family, weight, style)).toBe(expected);
  });
});

describe('buildEditContentStream', () => {
  it('produces a balanced text-drawing fragment', () => {
    const s = buildEditContentStream('FzEdit', 12, 72, 700.5, 'Hi (there)');
    expect(s).toBe('\nq BT /FzEdit 12.00 Tf 1 0 0 1 72.00 700.50 Tm (Hi \\(there\\)) Tj ET Q\n');
  });
});

describe('approxBaseline', () => {
  it('offsets the bbox bottom by ~0.21em', () => {
    expect(approxBaseline(700, 10)).toBeCloseTo(702.1);
  });
});
