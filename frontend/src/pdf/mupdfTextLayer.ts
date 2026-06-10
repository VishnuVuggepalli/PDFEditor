/** mupdf text-layer DOM construction, extracted from engineMupdf.ts so the
 * span building and chunking logic is unit-testable without a worker.
 *
 * Dense pages (the heavy perf fixture has ~3600 lines on page 1) used to
 * build every span in one synchronous pass, appending each span directly to
 * the live container. Two changes keep the main thread responsive:
 *
 *  - spans accumulate into a DocumentFragment per batch, so the live DOM
 *    sees one append per batch instead of one per line;
 *  - pages with more than TEXT_LAYER_CHUNK lines build incrementally,
 *    yielding between batches via scheduler.yield()/setTimeout, so no single
 *    task grows with page density.
 *
 * A newer build for the same container supersedes an in-flight chunked
 * build: after every yield the builder re-checks the container's epoch and
 * quietly stops if it lost ownership (superseded text layers are as routine
 * as superseded renders during zoom changes). */

import type { StextLine } from './mupdfProtocol';
import { displayMatrix, displayOrigin, transformPoint, type Mat } from './mupdfTransforms';

/** Lines per synchronous batch; pages at or below this build in one pass. */
export const TEXT_LAYER_CHUNK = 400;

function cssFamily(family: string): string {
  return family === 'serif' || family === 'monospace' ? family : 'sans-serif';
}

/* ---- shared measuring canvas for text layer scaleX correction ---- */

let measureCtx: CanvasRenderingContext2D | null | undefined;
let measureCtxFont = '';

function measureWidth(text: string, fontPx: number, family: string): number | null {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
    measureCtxFont = '';
  }
  if (!measureCtx) return null;
  const font = `${fontPx}px ${cssFamily(family)}`;
  // Assigning ctx.font re-parses the font string; skip when unchanged
  // (dense pages typically repeat one font over thousands of lines).
  if (font !== measureCtxFont) {
    measureCtx.font = font;
    measureCtxFont = font;
  }
  const w = measureCtx.measureText(text).width;
  return Number.isFinite(w) && w > 0 ? w : null;
}

/** Build the absolutely-positioned span for one structured-text line, or
 * null for lines with no text. Pure DOM construction; nothing is attached. */
function buildLineSpan(
  line: StextLine,
  m: Mat,
  ox: number,
  oy: number,
  rot: number,
  scale: number,
): HTMLSpanElement | null {
  if (!line.text) return null;
  const span = document.createElement('span');
  span.textContent = line.text;
  // Anchor: image of the line's fitz top-left corner. With transform-origin
  // 0 0 and rotate(extra), the span box covers the transformed line region
  // for every 90-degree rotation.
  const [ax, ay] = transformPoint(m, line.bbox.x, line.bbox.y);
  span.style.left = `${ax - ox}px`;
  span.style.top = `${ay - oy}px`;
  const fontPx = line.font.size * scale;
  span.style.fontSize = `${fontPx}px`;
  span.style.fontFamily = cssFamily(line.font.family);
  const target = line.bbox.w * scale;
  const measured = measureWidth(line.text, fontPx, line.font.family);
  const sx = measured ? target / measured : 1;
  const parts: string[] = [];
  if (rot !== 0) parts.push(`rotate(${rot}deg)`);
  if (Math.abs(sx - 1) > 0.001) parts.push(`scaleX(${sx.toFixed(4)})`);
  if (parts.length) span.style.transform = parts.join(' ');
  return span;
}

/** Yield to the browser between batches: scheduler.yield() when available
 * (continuation-priority, resumes promptly after pending input/paint), else
 * a plain macrotask. requestIdleCallback is deliberately NOT used here — on
 * a busy main thread it defers to its full timeout per chunk, which turned a
 * ~25 ms build into ~900 ms wall time in the perf harness. */
function yieldToEventLoop(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  };
  if (typeof g.scheduler?.yield === 'function') return g.scheduler.yield();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Monotonic build id per container: a newer build invalidates older
 * in-flight chunked builds for the same element. */
const buildEpochs = new WeakMap<HTMLDivElement, number>();

/** Populate `container` with selectable text spans for `lines`. Resolves
 * when the layer is complete, or earlier (quietly) when superseded by a
 * newer build for the same container. */
export async function buildTextLayer(
  container: HTMLDivElement,
  lines: readonly StextLine[],
  bounds: [number, number, number, number],
  scale: number,
  extraRotation: number,
): Promise<void> {
  const epoch = (buildEpochs.get(container) ?? 0) + 1;
  buildEpochs.set(container, epoch);
  container.replaceChildren();
  container.style.setProperty('--scale-factor', String(scale));
  const m = displayMatrix(scale, extraRotation);
  const [ox, oy] = displayOrigin(bounds, m);
  const rot = ((extraRotation % 360) + 360) % 360;
  for (let i = 0; i < lines.length; i += TEXT_LAYER_CHUNK) {
    if (i > 0) {
      await yieldToEventLoop();
      if (buildEpochs.get(container) !== epoch) return; // superseded
    }
    const frag = document.createDocumentFragment();
    const end = Math.min(lines.length, i + TEXT_LAYER_CHUNK);
    for (let j = i; j < end; j++) {
      const span = buildLineSpan(lines[j], m, ox, oy, rot, scale);
      if (span) frag.appendChild(span);
    }
    container.appendChild(frag);
  }
}
