import { describe, expect, it } from 'vitest';
import {
  dataUrlToBlob,
  placementRect,
  signatureBadge,
  strokesToViewportPaths,
  validateSignatureFile,
  MAX_SIGNATURE_IMAGE_BYTES,
} from './signature';

const PAGE = { width: 660, height: 850 };

describe('placementRect', () => {
  it('centers the rect on the click point', () => {
    const r = placementRect([330, 425], PAGE, 0.5, 170);
    expect(r.w).toBeCloseTo(170);
    expect(r.h).toBeCloseTo(85);
    expect(r.x + r.w / 2).toBeCloseTo(330);
    expect(r.y + r.h / 2).toBeCloseTo(425);
  });

  it('clamps to the page edges', () => {
    const tl = placementRect([0, 0], PAGE, 0.5, 170);
    expect(tl.x).toBe(0);
    expect(tl.y).toBe(0);
    const br = placementRect([660, 850], PAGE, 0.5, 170);
    expect(br.x + br.w).toBeCloseTo(660);
    expect(br.y + br.h).toBeCloseTo(850);
  });

  it('shrinks for pages narrower than the target width', () => {
    const r = placementRect([50, 50], { width: 100, height: 100 }, 0.5, 170);
    expect(r.w).toBeCloseTo(90); // 90% of page width
  });
});

describe('strokesToViewportPaths', () => {
  it('maps normalized pad strokes into the rect (y stays down)', () => {
    const rect = { x: 100, y: 200, w: 200, h: 100 };
    const paths = strokesToViewportPaths([[[0, 0], [1, 1]]], rect);
    expect(paths).toEqual([[[100, 200], [300, 300]]]);
  });

  it('drops single-point strokes', () => {
    expect(strokesToViewportPaths([[[0.5, 0.5]]], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
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

describe('signatureBadge', () => {
  it('maps valid signatures to a green badge with the signer', () => {
    expect(signatureBadge({ status: 'valid', signer: 'Alice' })).toEqual({
      tone: 'green',
      label: 'Valid — Alice',
    });
  });

  it('maps invalid signatures to a danger badge', () => {
    expect(signatureBadge({ status: 'invalid', signer: 'Alice' })).toEqual({
      tone: 'danger',
      label: 'Invalid — Alice',
    });
  });

  it('maps untrusted signers to an amber unknown-signer badge', () => {
    expect(signatureBadge({ status: 'unknown', signer: 'Bob' })).toEqual({
      tone: 'amber',
      label: 'Unknown signer — Bob',
    });
  });

  it('falls back to "Unknown" when the signer name is empty', () => {
    expect(signatureBadge({ status: 'unknown', signer: '' }).label).toBe(
      'Unknown signer — Unknown',
    );
  });
});
