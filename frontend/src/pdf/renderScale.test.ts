import { describe, expect, it } from 'vitest';
import { canvasScaleFactor, MAX_RENDER_SCALE, MIN_RENDER_SCALE } from './renderScale';

describe('canvasScaleFactor', () => {
  it.each([
    // DPR-1 displays get the 1.5x supersampling floor
    [1, 1.5],
    [1.25, 1.5],
    [1.5, 1.5],
    // real HiDPI ratios pass through unchanged
    [1.75, 1.75],
    [2, 2],
    [2.5, 2.5],
    [3, 3],
    // capped to bound canvas memory
    [4, 3],
    [10, 3],
  ])('maps devicePixelRatio %s to %s', (dpr, want) => {
    expect(canvasScaleFactor(dpr)).toBe(want);
  });

  it.each([
    [undefined, 1.5],
    [0, 1.5],
    [NaN, 1.5],
    [-2, 1.5],
  ])('treats invalid devicePixelRatio %s as 1 (floored to 1.5)', (dpr, want) => {
    expect(canvasScaleFactor(dpr)).toBe(want);
  });

  it('stays within the exported bounds for any input', () => {
    for (const dpr of [0.1, 0.5, 1, 1.4, 2, 3.1, 100]) {
      const f = canvasScaleFactor(dpr);
      expect(f).toBeGreaterThanOrEqual(MIN_RENDER_SCALE);
      expect(f).toBeLessThanOrEqual(MAX_RENDER_SCALE);
    }
  });
});
