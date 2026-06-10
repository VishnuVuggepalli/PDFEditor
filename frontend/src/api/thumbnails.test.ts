import { describe, expect, it } from 'vitest';
import {
  clampThumbWidth,
  THUMB_DEFAULT_WIDTH,
  THUMB_MAX_WIDTH,
  thumbnailUrl,
  thumbRequestWidth,
} from './thumbnails';

describe('clampThumbWidth', () => {
  it.each([
    [240, 240],
    [1, 1],
    [0, 1],
    [-50, 1],
    [1024, 1024],
    [1025, THUMB_MAX_WIDTH],
    [99999, THUMB_MAX_WIDTH],
    [240.6, 241],
    [NaN, THUMB_DEFAULT_WIDTH],
    [Infinity, THUMB_DEFAULT_WIDTH],
  ])('clamps %s to %s', (input, want) => {
    expect(clampThumbWidth(input)).toBe(want);
  });
});

describe('thumbRequestWidth', () => {
  it.each([
    // standard displays request 2x the CSS width
    [210, 1, 420],
    [40, 1, 80],
    [210, 1.5, 420],
    // HiDPI (DPR >= 2) requests 3x for extra sharpness
    [210, 2, 630],
    [210, 3, 630],
    [40, 2, 120],
    // clamped to the server max
    [400, 2, 1024],
    [600, 1, 1024],
    // invalid DPR falls back to 1 (2x)
    [210, 0, 420],
    [210, NaN, 420],
  ])('cssWidth %s at DPR %s requests %s', (cssWidth, dpr, want) => {
    expect(thumbRequestWidth(cssWidth, dpr)).toBe(want);
  });
});

describe('thumbnailUrl', () => {
  it('builds the endpoint URL with defaults (page 1, width 240)', () => {
    expect(thumbnailUrl('abc', 1)).toBe(
      '/api/v1/documents/abc/thumbnail?page=1&width=240&v=1',
    );
  });

  it('includes explicit page and width', () => {
    expect(thumbnailUrl('abc', 3, 480, 2)).toBe(
      '/api/v1/documents/abc/thumbnail?page=2&width=480&v=3',
    );
  });

  it('version-tags the URL so a new head version busts caches', () => {
    expect(thumbnailUrl('abc', 1)).not.toBe(thumbnailUrl('abc', 2));
  });

  it('clamps oversized widths to the server cap', () => {
    expect(thumbnailUrl('abc', 1, 5000)).toContain(`width=${THUMB_MAX_WIDTH}`);
  });

  it('URL-encodes the document id', () => {
    expect(thumbnailUrl('a/b c', 1)).toContain('/documents/a%2Fb%20c/thumbnail');
  });
});
