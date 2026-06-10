import { describe, expect, it } from 'vitest';
import {
  dataUrlToBlob,
  placementRect,
  strokesToPdfPaths,
  validateSignatureFile,
  MAX_SIGNATURE_IMAGE_BYTES,
} from './signature';

const LETTER: [number, number, number, number] = [0, 0, 612, 792];

describe('placementRect', () => {
  it('centers the default-width rect on the click point', () => {
    const r = placementRect([306, 396], LETTER, 0.5, 170);
    expect(r[2] - r[0]).toBeCloseTo(170);
    expect(r[3] - r[1]).toBeCloseTo(85);
    expect((r[0] + r[2]) / 2).toBeCloseTo(306);
    expect((r[1] + r[3]) / 2).toBeCloseTo(396);
  });

  it('clamps to the page edges', () => {
    const low = placementRect([0, 0], LETTER, 0.5, 170);
    expect(low[0]).toBe(0);
    expect(low[1]).toBe(0);
    const high = placementRect([612, 792], LETTER, 0.5, 170);
    expect(high[2]).toBeCloseTo(612);
    expect(high[3]).toBeCloseTo(792);
  });

  it('shrinks for pages narrower than the default width', () => {
    const tiny: [number, number, number, number] = [0, 0, 100, 100];
    const r = placementRect([50, 50], tiny, 0.5, 170);
    expect(r[2] - r[0]).toBeCloseTo(90); // 90% of page width
  });

  it('respects a shifted viewBox origin', () => {
    const shifted: [number, number, number, number] = [100, 100, 712, 892];
    const r = placementRect([100, 100], shifted, 0.5, 170);
    expect(r[0]).toBeGreaterThanOrEqual(100);
    expect(r[1]).toBeGreaterThanOrEqual(100);
  });
});

describe('strokesToPdfPaths', () => {
  it('maps normalized pad strokes into the rect with y flipped', () => {
    const rect: [number, number, number, number] = [100, 200, 300, 300];
    const paths = strokesToPdfPaths([[[0, 0], [1, 1]]], rect);
    // pad top-left (0,0) → rect top-left (100, 300); pad bottom-right → (300, 200)
    expect(paths).toEqual([[100, 300, 300, 200]]);
  });

  it('drops single-point strokes', () => {
    const rect: [number, number, number, number] = [0, 0, 10, 10];
    expect(strokesToPdfPaths([[[0.5, 0.5]]], rect)).toEqual([]);
  });
});

/** jsdom's Blob lacks arrayBuffer()/text(); FileReader works in both. */
function readBlob(b: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsArrayBuffer(b);
  });
}

describe('dataUrlToBlob', () => {
  it('decodes base64 payloads preserving the mime type', async () => {
    // "PNG!" in base64
    const blob = dataUrlToBlob('data:image/png;base64,UE5HIQ==');
    expect(blob.type).toBe('image/png');
    expect(await readBlob(blob)).toEqual(new Uint8Array([0x50, 0x4e, 0x47, 0x21]));
  });

  it('handles URL-encoded (non-base64) payloads', async () => {
    const blob = dataUrlToBlob('data:text/plain,hi%20there');
    expect(blob.type).toBe('text/plain');
    expect(new TextDecoder().decode(await readBlob(blob))).toBe('hi there');
  });
});

describe('validateSignatureFile', () => {
  it('accepts png and jpeg under the cap', () => {
    expect(validateSignatureFile({ type: 'image/png', size: 1024 })).toBeNull();
    expect(validateSignatureFile({ type: 'image/jpeg', size: 1024 })).toBeNull();
  });

  it('rejects other types, oversized and empty files', () => {
    expect(validateSignatureFile({ type: 'image/gif', size: 10 })).toMatch(/PNG or JPEG/);
    expect(
      validateSignatureFile({ type: 'image/png', size: MAX_SIGNATURE_IMAGE_BYTES + 1 }),
    ).toMatch(/5 MB/);
    expect(validateSignatureFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});
