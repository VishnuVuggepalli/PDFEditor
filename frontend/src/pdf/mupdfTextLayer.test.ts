/** Chunked text-layer builder: span construction, fragment batching,
 * idle-callback chunking, and supersede-on-rebuild semantics. Geometry of
 * the spans (rotation/scale anchors) is additionally covered end-to-end via
 * the engine facade in engineMupdf.test.ts. */
import { describe, expect, it } from 'vitest';
import type { StextLine } from './mupdfProtocol';
import { buildTextLayer, TEXT_LAYER_CHUNK } from './mupdfTextLayer';

const BOUNDS: [number, number, number, number] = [0, 0, 595, 842];

function line(text: string, x = 72, y = 96): StextLine {
  return {
    text,
    bbox: { x, y, w: 200, h: 32 },
    font: { name: 'Helvetica', family: 'sans-serif', weight: 'normal', style: 'normal', size: 24 },
  };
}

function container(): HTMLDivElement {
  return document.createElement('div');
}

describe('buildTextLayer', () => {
  it('builds one positioned span per non-empty line', async () => {
    const el = container();
    await buildTextLayer(el, [line('Hello world'), line('', 72, 150), line('Second', 72, 200)], BOUNDS, 1, 0);
    const spans = el.querySelectorAll<HTMLElement>(':scope > span');
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe('Hello world');
    expect(spans[0].style.left).toBe('72px');
    expect(spans[0].style.top).toBe('96px');
    expect(spans[0].style.fontSize).toBe('24px');
    expect(el.style.getPropertyValue('--scale-factor')).toBe('1');
  });

  it('applies scale and rotation', async () => {
    const el = container();
    await buildTextLayer(el, [line('Hello world')], BOUNDS, 0.5, 90);
    const span = el.querySelector<HTMLElement>(':scope > span')!;
    // fitz (72,96) -> rot90+scale0.5 (-48,36); origin (-421,0) -> left 373, top 36
    expect(span.style.left).toBe('373px');
    expect(span.style.top).toBe('36px');
    expect(span.style.fontSize).toBe('12px');
    expect(span.style.transform).toContain('rotate(90deg)');
  });

  it('replaces previous content on rebuild', async () => {
    const el = container();
    await buildTextLayer(el, [line('old A'), line('old B')], BOUNDS, 1, 0);
    await buildTextLayer(el, [line('new')], BOUNDS, 1, 0);
    const spans = el.querySelectorAll(':scope > span');
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe('new');
  });

  it('builds dense pages completely across idle chunks', async () => {
    const lines = Array.from({ length: TEXT_LAYER_CHUNK * 2 + 50 }, (_, i) => line(`l${i}`, 10, i));
    const el = container();
    const build = buildTextLayer(el, lines, BOUNDS, 1, 0);
    // only the first synchronous chunk is in the DOM before yielding
    expect(el.querySelectorAll(':scope > span')).toHaveLength(TEXT_LAYER_CHUNK);
    await build;
    expect(el.querySelectorAll(':scope > span')).toHaveLength(lines.length);
  });

  it('a newer build supersedes an in-flight chunked build', async () => {
    const dense = Array.from({ length: TEXT_LAYER_CHUNK * 3 }, (_, i) => line(`stale${i}`, 10, i));
    const el = container();
    const stale = buildTextLayer(el, dense, BOUNDS, 1, 0);
    const fresh = buildTextLayer(el, [line('fresh')], BOUNDS, 1, 0);
    await Promise.all([stale, fresh]);
    // wait out any straggler idle callbacks from the superseded build
    await new Promise((r) => setTimeout(r, 10));
    const spans = el.querySelectorAll(':scope > span');
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe('fresh');
  });

  it('chunked builds on different containers do not interfere', async () => {
    const dense = Array.from({ length: TEXT_LAYER_CHUNK + 1 }, (_, i) => line(`a${i}`, 10, i));
    const a = container();
    const b = container();
    await Promise.all([
      buildTextLayer(a, dense, BOUNDS, 1, 0),
      buildTextLayer(b, [line('solo')], BOUNDS, 1, 0),
    ]);
    expect(a.querySelectorAll(':scope > span')).toHaveLength(dense.length);
    expect(b.querySelectorAll(':scope > span')).toHaveLength(1);
  });
});
