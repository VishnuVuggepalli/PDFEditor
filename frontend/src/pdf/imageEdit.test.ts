/** Pure image-edit math: hit-testing, aspect-fit placement, the insertion
 * content-stream fragment, file sniffing, and selection-box geometry. */
import { describe, expect, it } from 'vitest';
import type { PageImageInfo } from './mupdfProtocol';
import {
  buildImageContentStream,
  fitRectWithin,
  imageAtPoint,
  moveRect,
  rectsAlmostEqual,
  resizeRect,
  sniffImageFile,
} from './imageEdit';

function img(index: number, fitzBox: [number, number, number, number]): PageImageInfo {
  return { index, fitzBox, transform: [1, 0, 0, 1, 0, 0], width: 40, height: 30 };
}

describe('imageAtPoint', () => {
  const images = [img(0, [100, 100, 300, 250]), img(1, [200, 200, 400, 350])];

  it('finds the image containing the point', () => {
    expect(imageAtPoint(images, 120, 120)?.index).toBe(0);
    expect(imageAtPoint(images, 380, 340)?.index).toBe(1);
  });

  it('prefers the topmost (last-painted) image where paints overlap', () => {
    expect(imageAtPoint(images, 250, 225)?.index).toBe(1);
  });

  it('treats edges as inside and misses outside points', () => {
    expect(imageAtPoint(images, 100, 100)?.index).toBe(0);
    expect(imageAtPoint(images, 99, 100)).toBeNull();
    expect(imageAtPoint([], 1, 1)).toBeNull();
  });
});

describe('fitRectWithin', () => {
  it('fits a wide image into a tall rect, centered vertically', () => {
    // 2:1 image into a 100x200 rect -> 100x50 centered at y 175..225
    expect(fitRectWithin(200, 100, [0, 100, 100, 300])).toEqual([0, 175, 100, 225]);
  });

  it('fits a tall image into a wide rect, centered horizontally', () => {
    // 1:2 image into a 200x100 rect -> 50x100 centered at x 75..125
    expect(fitRectWithin(100, 200, [0, 0, 200, 100])).toEqual([75, 0, 125, 100]);
  });

  it('fills the rect exactly when aspect ratios match', () => {
    expect(fitRectWithin(40, 30, [10, 20, 90, 80])).toEqual([10, 20, 90, 80]);
  });

  it('collapses to the target on degenerate inputs', () => {
    expect(fitRectWithin(0, 30, [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(fitRectWithin(40, 30, [5, 5, 5, 9])).toEqual([5, 5, 5, 9]);
  });
});

describe('buildImageContentStream', () => {
  it('maps the image unit square onto the rect with a cm + Do', () => {
    expect(buildImageContentStream('FzImg', [100, 500, 300, 650])).toBe(
      '\nq 200.00 0 0 150.00 100.00 500.00 cm /FzImg Do Q\n',
    );
  });
});

describe('sniffImageFile', () => {
  it('recognizes PNG and JPEG magic bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(sniffImageFile(png)).toBe('png');
    expect(sniffImageFile(jpg)).toBe('jpeg');
  });

  it('rejects other formats and truncated headers', () => {
    expect(sniffImageFile(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull(); // GIF
    expect(sniffImageFile(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageFile(new Uint8Array([]))).toBeNull();
  });
});

const PAGE = { width: 600, height: 800 };

describe('moveRect', () => {
  const start = { x: 100, y: 100, w: 200, h: 150 };

  it('translates by the pointer delta', () => {
    expect(moveRect(start, 30, -20, PAGE)).toEqual({ x: 130, y: 80, w: 200, h: 150 });
  });

  it('clamps so the box stays fully on the page', () => {
    expect(moveRect(start, -500, 9000, PAGE)).toEqual({ x: 0, y: 650, w: 200, h: 150 });
  });
});

describe('resizeRect', () => {
  const start = { x: 100, y: 100, w: 200, h: 150 };

  it('moves only the dragged corner edges', () => {
    expect(resizeRect(start, 'se', 50, 30, PAGE)).toEqual({ x: 100, y: 100, w: 250, h: 180 });
    expect(resizeRect(start, 'nw', 20, 10, PAGE)).toEqual({ x: 120, y: 110, w: 180, h: 140 });
    expect(resizeRect(start, 'ne', -50, 25, PAGE)).toEqual({ x: 100, y: 125, w: 150, h: 125 });
    expect(resizeRect(start, 'sw', 40, -30, PAGE)).toEqual({ x: 140, y: 100, w: 160, h: 120 });
  });

  it('enforces the minimum box size', () => {
    const r = resizeRect(start, 'se', -1000, -1000, PAGE, 12);
    expect(r).toEqual({ x: 100, y: 100, w: 12, h: 12 });
  });

  it('clamps growing edges to the page bounds', () => {
    const r = resizeRect(start, 'se', 9999, 9999, PAGE);
    expect(r).toEqual({ x: 100, y: 100, w: 500, h: 700 });
    const r2 = resizeRect(start, 'nw', -9999, -9999, PAGE);
    expect(r2).toEqual({ x: 0, y: 0, w: 300, h: 250 });
  });
});

describe('rectsAlmostEqual', () => {
  it('tolerates sub-pixel drift but flags real changes', () => {
    const a = { x: 10, y: 10, w: 100, h: 50 };
    expect(rectsAlmostEqual(a, { ...a, x: 10.4 })).toBe(true);
    expect(rectsAlmostEqual(a, { ...a, x: 11 })).toBe(false);
    expect(rectsAlmostEqual(a, { ...a, h: 51 })).toBe(false);
  });
});
