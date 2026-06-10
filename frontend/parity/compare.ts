/** Pure comparison metrics for the engine-parity harness. AA-tolerant pixel
 * comparison works on box-downsampled grayscale: antialiasing differences
 * between rasterizers vanish under a 4x box filter, while structural errors
 * (wrong rotation, wrong crop origin, shifted text) survive it. */

export interface PixelDiff {
  /** fraction of downsampled cells whose gray delta exceeds the threshold */
  changedFraction: number;
  /** mean absolute gray delta over all cells */
  meanDelta: number;
  cells: number;
}

/** RGBA -> grayscale, box-downsampled by `factor`. */
export function grayDownsample(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  factor: number,
): { data: Float64Array; w: number; h: number } {
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const data = new Float64Array(w * h);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (cy * factor + dy) * width;
        for (let dx = 0; dx < factor; dx++) {
          const i = (row + cx * factor + dx) * 4;
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
        }
      }
      data[cy * w + cx] = sum / (factor * factor);
    }
  }
  return { data, w, h };
}

/** Compare two same-size RGBA buffers; threshold is the per-cell gray delta
 * counted as "changed". Compares over the common (min) dimensions so a 1px
 * rounding difference does not crash the harness. */
export function pixelDiff(
  a: { pixels: Uint8ClampedArray; width: number; height: number },
  b: { pixels: Uint8ClampedArray; width: number; height: number },
  factor = 4,
  threshold = 40,
): PixelDiff {
  const ga = grayDownsample(a.pixels, a.width, a.height, factor);
  const gb = grayDownsample(b.pixels, b.width, b.height, factor);
  const w = Math.min(ga.w, gb.w);
  const h = Math.min(ga.h, gb.h);
  let changed = 0;
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.abs(ga.data[y * ga.w + x] - gb.data[y * gb.w + x]);
      total += d;
      if (d > threshold) changed++;
    }
  }
  const cells = w * h;
  return { changedFraction: cells ? changed / cells : 1, meanDelta: cells ? total / cells : 255, cells };
}

/** Fraction of pixels darker than mid-gray ("ink"). Guards against the
 * degenerate pass where both engines render blank: each engine must put a
 * comparable amount of ink on the page. */
export function inkFraction(rgba: Uint8ClampedArray, width: number, height: number): number {
  const n = width * height;
  let dark = 0;
  for (let i = 0; i < n; i++) {
    const g = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    if (g < 128) dark++;
  }
  return n ? dark / n : 0;
}

/* ---- text comparison ---- */

const CJK_RE = /[\u3000-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/** Tokenize for similarity: whitespace-split words, but CJK text (which has
 * no spaces) splits into individual characters. Lowercased, punctuation kept
 * only inside Latin words. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of text.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    if (CJK_RE.test(word)) {
      for (const ch of word) out.push(ch);
    } else {
      out.push(word);
    }
  }
  return out;
}

/** Sørensen–Dice similarity over token multisets (0..1). */
export function tokenSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);
  let overlap = 0;
  for (const t of tb) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(t, c - 1);
    }
  }
  return (2 * overlap) / (ta.length + tb.length);
}

/** Page numbers (1-based) whose text contains the query — the exact
 * semantics of the in-app search (Viewer.tsx lowercased substring). */
export function searchHits(pageTexts: readonly string[], query: string): number[] {
  const q = query.toLowerCase();
  const hits: number[] = [];
  pageTexts.forEach((t, i) => {
    if (t.toLowerCase().includes(q)) hits.push(i + 1);
  });
  return hits;
}
