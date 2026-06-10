/** Engine parity corpus: render every fixture through BOTH engines headless
 * and compare pixels (AA-tolerant), extracted text, and search hits.
 *
 * - mupdf side goes through the exact worker code paths (mupdfPageOps), so
 *   transform bugs in displayMatrix/readPageInfo fail here.
 * - pdf.js side mirrors src/pdf/engine.ts (viewport rotation = page.rotate,
 *   text() join semantics).
 *
 * Run: npm run test:parity
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

// pdf.js paints glyph outlines through these DOM globals; in node they must
// come from @napi-rs/canvas BEFORE pdf.js is imported.
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
import { readPageInfo, readTextLines, renderPageRgba } from '../src/pdf/mupdfPageOps';
import { inkFraction, pixelDiff, searchHits, tokenSimilarity } from './compare';

const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONTS = path.join(PDFJS_ROOT, 'standard_fonts') + '/';
const CMAPS = path.join(PDFJS_ROOT, 'cmaps') + '/';

/** Pixel parity gate: fraction of 4x-downsampled cells allowed to differ. */
const MAX_CHANGED_FRACTION = 0.015;
/** Text parity gate: Sørensen–Dice token similarity per page. */
const MIN_TEXT_SIMILARITY = 0.95;

interface Query {
  q: string;
  /** 'parity': hit sets must match. 'report': record only (documented diff). */
  mode: 'parity' | 'report';
}

interface Fixture {
  name: string;
  scale: number;
  queries: Query[];
}

const CORPUS: Fixture[] = [
  { name: 'rotate90', scale: 2, queries: [{ q: 'quadrant', mode: 'parity' }, { q: 'zebra', mode: 'parity' }] },
  { name: 'rotate270', scale: 2, queries: [{ q: 'quadrant', mode: 'parity' }, { q: 'zebra', mode: 'parity' }] },
  {
    name: 'cropbox',
    scale: 2,
    queries: [
      { q: 'walrus', mode: 'parity' },
      { q: 'crop window', mode: 'parity' },
      // Text outside the CropBox: measured 2026-06-10, BOTH engines exclude
      // it from extraction (mupdf clips stext to the page box; pdf.js's
      // getTextContent also drops it). Kept as a recorded probe in case a
      // future engine upgrade changes either side.
      { q: 'offcrop', mode: 'report' },
    ],
  },
  { name: 'cjk', scale: 2, queries: [{ q: '你好世界', mode: 'parity' }, { q: '第二页', mode: 'parity' }] },
  { name: 'multicol', scale: 2, queries: [{ q: 'gamma line 60', mode: 'parity' }, { q: 'quokka', mode: 'parity' }] },
  { name: 'a0', scale: 0.75, queries: [{ q: 'poster heading', mode: 'parity' }, { q: 'ibex', mode: 'parity' }] },
];

interface EngineRead {
  pageCount: number;
  /** RGBA render per page at the fixture scale */
  renders: { pixels: Uint8ClampedArray; width: number; height: number }[];
  /** page text exactly as PageHandle.text() produces it */
  texts: string[];
}

function readMupdf(bytes: Uint8Array, scale: number): EngineRead {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const pdf = doc.asPDF();
    if (!pdf) throw new Error('not a PDF');
    const renders: EngineRead['renders'] = [];
    const texts: string[] = [];
    for (let n = 0; n < pdf.countPages(); n++) {
      const page = pdf.loadPage(n);
      readPageInfo(page); // exercises viewBox/rotation extraction
      renders.push(renderPageRgba(mupdf, page, scale, 0));
      texts.push(
        readTextLines(page)
          .map((l) => l.text)
          .join(' ')
          .replace(/\s+/g, ' '),
      );
    }
    return { pageCount: pdf.countPages(), renders, texts };
  } finally {
    doc.destroy();
  }
}

async function readPdfjs(bytes: Uint8Array, scale: number): Promise<EngineRead> {
  const doc = await getDocument({
    data: bytes.slice(),
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    // node has no FontFace API; glyphs paint via path data (the node default,
    // made explicit so the harness stays deterministic)
    disableFontFace: true,
  }).promise;
  try {
    const renders: EngineRead['renders'] = [];
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      // mirror engine.ts: rotation = intrinsic page.rotate (+0 extra)
      const viewport = page.getViewport({ scale, rotation: page.rotate });
      const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      renders.push({
        pixels: new Uint8ClampedArray(img.data.buffer, 0, canvas.width * canvas.height * 4),
        width: canvas.width,
        height: canvas.height,
      });
      const content = await page.getTextContent();
      texts.push(
        content.items
          .map((it) => ('str' in it ? it.str : ''))
          .join(' ')
          .replace(/\s+/g, ' '),
      );
    }
    return { pageCount: doc.numPages, renders, texts };
  } finally {
    await doc.destroy();
  }
}

/* ---- results table accumulated across tests ---- */
const rows: string[] = [];
afterAll(() => {
  console.log('\n== engine parity results ==');
  console.log(
    'fixture    pg  size(mupdf)   size(pdfjs)   px-changed  px-meanΔ  ink(mu/pj)       text-sim  search',
  );
  for (const r of rows) console.log(r);
});

describe.each(CORPUS)('parity: $name', ({ name, scale, queries }) => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURES, `${name}.pdf`)));

  it('renders, extracts and searches identically in both engines', async () => {
    const mu = readMupdf(bytes, scale);
    const pj = await readPdfjs(bytes, scale);
    expect(mu.pageCount).toBe(pj.pageCount);

    for (let i = 0; i < mu.pageCount; i++) {
      const a = mu.renders[i];
      const b = pj.renders[i];
      // dimension parity (catches rotation/crop transform bugs outright)
      expect(Math.abs(a.width - b.width), `${name} p${i + 1} width`).toBeLessThanOrEqual(2);
      expect(Math.abs(a.height - b.height), `${name} p${i + 1} height`).toBeLessThanOrEqual(2);

      // both engines must put a comparable amount of ink on the page —
      // otherwise "blank vs blank" sails through the diff tolerance
      const inkA = inkFraction(a.pixels, a.width, a.height);
      const inkB = inkFraction(b.pixels, b.width, b.height);
      expect(inkA, `${name} p${i + 1} mupdf rendered blank`).toBeGreaterThan(0.0005);
      expect(inkB, `${name} p${i + 1} pdfjs rendered blank`).toBeGreaterThan(0.0005);
      expect(
        Math.abs(inkA - inkB),
        `${name} p${i + 1} ink divergence (mupdf ${inkA.toFixed(4)} vs pdfjs ${inkB.toFixed(4)})`,
      ).toBeLessThanOrEqual(Math.max(0.001, 0.2 * Math.max(inkA, inkB)));

      const diff = pixelDiff(a, b);
      const sim = tokenSimilarity(mu.texts[i], pj.texts[i]);
      const searchResults: string[] = [];
      for (const { q, mode } of queries) {
        const ha = searchHits(mu.texts, q).join(',') || '-';
        const hb = searchHits(pj.texts, q).join(',') || '-';
        if (mode === 'parity') {
          expect(ha, `${name} search "${q}"`).toBe(hb);
          searchResults.push(`"${q}":${ha === hb ? 'ok' : 'DIFF'}`);
        } else {
          searchResults.push(`"${q}":mupdf=[${ha}] pdfjs=[${hb}] (documented)`);
        }
      }
      rows.push(
        `${name.padEnd(10)} ${String(i + 1).padEnd(3)} ` +
          `${`${a.width}x${a.height}`.padEnd(13)} ${`${b.width}x${b.height}`.padEnd(13)} ` +
          `${(diff.changedFraction * 100).toFixed(2).padStart(8)}%  ` +
          `${diff.meanDelta.toFixed(1).padStart(7)}  ` +
          `${`${(inkA * 100).toFixed(2)}%/${(inkB * 100).toFixed(2)}%`.padEnd(15)}  ` +
          `${sim.toFixed(3).padStart(7)}  ` +
          (i === 0 ? searchResults.join(' ') : ''),
      );

      expect(diff.changedFraction, `${name} p${i + 1} pixel diff`).toBeLessThanOrEqual(
        MAX_CHANGED_FRACTION,
      );
      expect(sim, `${name} p${i + 1} text similarity`).toBeGreaterThanOrEqual(MIN_TEXT_SIMILARITY);
    }
  });
});
