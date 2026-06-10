/** Engine wrapper tests with the wasm module mocked. Geometry expectations
 * are anchored to values measured against the real wasm in
 * scripts/mupdf-coords.mjs (page transform [1,0,0,-1,0,842], fitz y-down
 * structured text boxes, redact rects in fitz space). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ---- fake PDFObject tree ---- */

class FakeObj {
  kind: 'null' | 'number' | 'array' | 'dict' | 'stream';
  value: unknown;
  items: FakeObj[] = [];
  dict = new Map<string, FakeObj>();

  constructor(kind: FakeObj['kind'], value?: unknown) {
    this.kind = kind;
    this.value = value;
  }

  static num(v: number) {
    return new FakeObj('number', v);
  }
  static arr(nums: number[]) {
    const o = new FakeObj('array');
    o.items = nums.map((n) => FakeObj.num(n));
    return o;
  }

  isNull() {
    return this.kind === 'null';
  }
  isNumber() {
    return this.kind === 'number';
  }
  isArray() {
    return this.kind === 'array';
  }
  isDictionary() {
    return this.kind === 'dict';
  }
  asNumber() {
    return this.value as number;
  }
  get length() {
    return this.items.length;
  }
  get(key: number | string): FakeObj {
    if (typeof key === 'number') return this.items[key] ?? new FakeObj('null');
    return this.dict.get(key) ?? new FakeObj('null');
  }
  getInheritable(key: string): FakeObj {
    return this.get(key);
  }
  put(key: string, value: FakeObj) {
    this.dict.set(key, value);
  }
  push(value: FakeObj) {
    this.items.push(value);
  }
}

/* ---- fake page/document ---- */

const STEXT = {
  blocks: [
    {
      type: 'text',
      bbox: { x: 72, y: 96, w: 308, h: 32 },
      lines: [
        {
          text: 'Hello world',
          bbox: { x: 72, y: 96, w: 200, h: 32 },
          font: { name: 'Helvetica', family: 'sans-serif', weight: 'normal', style: 'normal', size: 24 },
        },
        {
          text: 'Second line',
          bbox: { x: 72, y: 200, w: 150, h: 16 },
          font: { name: 'Times-Roman', family: 'serif', weight: 'normal', style: 'normal', size: 12 },
        },
      ],
    },
  ],
};

function makeFakes() {
  const calls: Record<string, unknown[][]> = {};
  const track = (name: string, ...args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };

  const pageObj = new FakeObj('dict');
  pageObj.put('MediaBox', FakeObj.arr([0, 0, 595, 842]));
  const resources = new FakeObj('dict');
  pageObj.put('Resources', resources);
  pageObj.put('Contents', new FakeObj('stream'));

  const fakeAnnot = {
    setRect: (r: unknown) => track('annot.setRect', r),
  };

  const fakePixmap = {
    getWidth: () => 2,
    getHeight: () => 2,
    getStride: () => 6,
    getPixels: () => new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
    destroy: () => track('pixmap.destroy'),
  };

  const fakePage = {
    getBounds: () => [0, 0, 595, 842],
    getTransform: () => [1, 0, 0, -1, 0, 842],
    getObject: () => pageObj,
    toStructuredText: (opts?: string) => {
      track('toStructuredText', opts);
      return { asJSON: () => JSON.stringify(STEXT), destroy: () => track('stext.destroy') };
    },
    toPixmap: (...args: unknown[]) => {
      track('toPixmap', ...args);
      return fakePixmap;
    },
    createAnnotation: (type: string) => {
      track('createAnnotation', type);
      return fakeAnnot;
    },
    applyRedactions: (...args: unknown[]) => track('applyRedactions', ...args),
    destroy: () => track('page.destroy'),
  };

  const savedBytes = new Uint8Array([1, 2, 3, 4]);
  const fakeDoc = {
    countPages: () => 2,
    loadPage: (i: number) => {
      track('loadPage', i);
      return fakePage;
    },
    asPDF: function () {
      return this;
    },
    isPDF: () => true,
    addSimpleFont: (f: unknown) => {
      track('addSimpleFont', f);
      return new FakeObj('dict');
    },
    addStream: (data: unknown) => {
      track('addStream', data);
      return new FakeObj('stream');
    },
    newDictionary: () => new FakeObj('dict'),
    newArray: () => new FakeObj('array'),
    saveToBuffer: (opts: unknown) => {
      track('saveToBuffer', opts);
      return { asUint8Array: () => savedBytes, destroy: () => track('buffer.destroy') };
    },
    destroy: () => track('doc.destroy'),
  };

  return { calls, pageObj, fakeDoc, fakePage };
}

const fakes = vi.hoisted(() => ({ current: null as ReturnType<typeof makeFakes> | null }));

vi.mock('mupdf', () => ({
  Document: {
    openDocument: () => fakes.current!.fakeDoc,
  },
  ColorSpace: { DeviceRGB: 'DeviceRGB' },
  Font: class {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
  },
  PDFPage: { REDACT_IMAGE_NONE: 0, REDACT_LINE_ART_NONE: 0, REDACT_TEXT_REMOVE: 0 },
}));

import { loadPdfMupdf } from './engineMupdf';
import { canEditText } from './engineApi';

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })));
}

beforeEach(() => {
  fakes.current = makeFakes();
  stubFetch();
});

describe('loadPdfMupdf', () => {
  it('loads a document and reports the page count', async () => {
    const pdf = await loadPdfMupdf('/api/v1/documents/x');
    expect(pdf.pageCount).toBe(2);
    expect(canEditText(pdf)).toBe(true);
  });

  it('rejects when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(loadPdfMupdf('/missing')).rejects.toThrow('404');
  });
});

describe('page geometry', () => {
  it('exposes viewBox, rotation and rotated base sizes', async () => {
    const pdf = await loadPdfMupdf('/doc');
    const page = await pdf.page(1);
    expect(page.n).toBe(1);
    expect(page.baseRotation).toBe(0);
    expect(page.viewBox).toEqual([0, 0, 595, 842]);
    expect(page.baseSize()).toEqual({ width: 595, height: 842 });
    expect(page.baseSize(90)).toEqual({ width: 842, height: 595 });
    expect(page.viewportParams(2, 90)).toEqual({ rotation: 90, scale: 2, viewBox: [0, 0, 595, 842] });
  });

  it('caches page handles and rejects out-of-range pages', async () => {
    const pdf = await loadPdfMupdf('/doc');
    const a = await pdf.page(1);
    const b = await pdf.page(1);
    expect(a).toBe(b);
    expect(fakes.current!.calls['loadPage']).toHaveLength(1);
    await expect(pdf.page(3)).rejects.toThrow('out of range');
  });
});

describe('render', () => {
  it('blits an RGBA-expanded pixmap into the canvas', async () => {
    const pdf = await loadPdfMupdf('/doc');
    const page = await pdf.page(1);
    const canvas = document.createElement('canvas');
    const putImageData = vi.fn();
    const ctx = { putImageData } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
    vi.stubGlobal('ImageData', class {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(data: Uint8ClampedArray, w: number, h: number) {
        this.data = data;
        this.width = w;
        this.height = h;
      }
    });

    await page.render(canvas, 1);
    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(2);
    expect(canvas.style.width).toBe('595px');
    expect(putImageData).toHaveBeenCalledTimes(1);
    const img = putImageData.mock.calls[0][0] as { data: Uint8ClampedArray };
    expect(Array.from(img.data.slice(0, 8))).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    // pixmap freed even on success
    expect(fakes.current!.calls['pixmap.destroy']).toHaveLength(1);
  });

  it('throws when no 2d context is available', async () => {
    const pdf = await loadPdfMupdf('/doc');
    const page = await pdf.page(1);
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    await expect(page.render(canvas, 1)).rejects.toThrow('canvas 2d context');
  });
});

describe('text layer', () => {
  it('emits absolutely positioned spans compatible with the search-mark contract', async () => {
    const pdf = await loadPdfMupdf('/doc');
    const page = await pdf.page(1);
    const container = document.createElement('div');
    await page.renderTextLayer(container, 1);
    const spans = container.querySelectorAll<HTMLElement>(':scope > span');
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe('Hello world');
    expect(spans[0].style.left).toBe('72px');
    expect(spans[0].style.top).toBe('96px');
    expect(spans[0].style.fontSize).toBe('24px');
    expect(container.style.getPropertyValue('--scale-factor')).toBe('1');
  });

  it('scales and rotates spans for a pending rotation delta', async () => {
    const pdf = await loadPdfMupdf('/doc');
    const page = await pdf.page(1);
    const container = document.createElement('div');
    await page.renderTextLayer(container, 0.5, 90);
    const span = container.querySelector<HTMLElement>(':scope > span')!;
    // fitz (72,96) -> rot90+scale0.5 (-48,36); origin (-421,0) -> left 373, top 36
    expect(span.style.left).toBe('373px');
    expect(span.style.top).toBe('36px');
    expect(span.style.fontSize).toBe('12px');
    expect(span.style.transform).toContain('rotate(90deg)');
  });

  it('plain text joins lines (used by search counting)', async () => {
    const pdf = await loadPdfMupdf('/doc');
    const page = await pdf.page(1);
    expect(await page.text()).toBe('Hello world Second line');
  });
});

describe('text editing', () => {
  it('finds the span under a PDF-space (y-up) point', async () => {
    const pdf = await loadPdfMupdf('/doc');
    if (!canEditText(pdf)) throw new Error('expected edit capability');
    // PDF y-up point inside line 1: fitz y 96..128 -> pdf y 714..746
    const span = await pdf.textSpanAt(1, 100, 730);
    expect(span).not.toBeNull();
    expect(span!.text).toBe('Hello world');
    expect(span!.fitzBox).toEqual([72, 96, 272, 128]);
    expect(span!.bbox).toEqual([72, 714, 272, 746]);
    expect(span!.fontSize).toBe(24);
    expect(await pdf.textSpanAt(1, 500, 500)).toBeNull();
  });

  it('replaces a span via redaction + appended content stream', async () => {
    const pdf = await loadPdfMupdf('/doc');
    if (!canEditText(pdf)) throw new Error('expected edit capability');
    const span = (await pdf.textSpanAt(1, 100, 730))!;
    const bytes = await pdf.replaceTextSpan(span, 'Replacement');
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);

    const calls = fakes.current!.calls;
    expect(calls['createAnnotation']).toEqual([['Redact']]);
    expect(calls['annot.setRect']).toEqual([[[72, 96, 272, 128]]]);
    expect(calls['applyRedactions']).toEqual([[false, 0, 0, 0]]);
    // replacement drawn with the original font size at the span position
    const fragment = calls['addStream'][0][0] as string;
    expect(fragment).toContain('/FzEdit 24.00 Tf');
    expect(fragment).toContain('(Replacement) Tj');
    // content stream became [original, extra]
    const contents = fakes.current!.pageObj.get('Contents');
    expect(contents.isArray()).toBe(true);
    expect(contents.length).toBe(2);
    // font registered in page resources
    const fonts = fakes.current!.pageObj.get('Resources').get('Font');
    expect(fonts.get('FzEdit').isNull()).toBe(false);
  });

  it('skips drawing when the replacement is empty (pure deletion)', async () => {
    const pdf = await loadPdfMupdf('/doc');
    if (!canEditText(pdf)) throw new Error('expected edit capability');
    const span = (await pdf.textSpanAt(1, 100, 730))!;
    await pdf.replaceTextSpan(span, '   ');
    expect(fakes.current!.calls['applyRedactions']).toHaveLength(1);
    expect(fakes.current!.calls['addStream']).toBeUndefined();
  });
});

describe('destroy', () => {
  it('destroys cached pages and the document, then refuses further use', async () => {
    const pdf = await loadPdfMupdf('/doc');
    await pdf.page(1);
    pdf.destroy();
    expect(fakes.current!.calls['page.destroy']).toHaveLength(1);
    expect(fakes.current!.calls['doc.destroy']).toHaveLength(1);
    await expect(pdf.page(1)).rejects.toThrow('destroyed');
  });
});
