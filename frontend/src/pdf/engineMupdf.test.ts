/** Engine facade tests with the worker boundary mocked: a fake RpcPort
 * answers protocol requests with canned results, so these tests cover the
 * main-thread half (DOM blits, text layer, hit testing, per-canvas render
 * cancellation) without wasm or a real Worker. Geometry fixtures match
 * scripts/mupdf-coords.mjs measurements (page transform [1,0,0,-1,0,842],
 * fitz y-down boxes). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPdfMupdf } from './engineMupdf';
import { canEditImages, canEditText } from './engineApi';
import {
  MupdfRpc,
  type ClientMessage,
  type MupdfRequest,
  type RpcPort,
  type WorkerMessage,
} from './mupdfProtocol';

const LINES = [
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
];

const SAVED = [1, 2, 3, 4];

/** One image paint: fitz box [100,192,300,342] on the 842pt page is the
 * PDF-space (y-up) rect [100,500,300,650]. */
const IMAGES = [
  {
    index: 0,
    fitzBox: [100, 192, 300, 342],
    transform: [200, 0, 0, 150, 100, 192],
    width: 40,
    height: 30,
  },
];

/** Emulates the worker: answers each request with a canned result. With
 * `hold = true` replies queue up until flush() — used to test superseded
 * renders. */
class FakeWorkerPort implements RpcPort {
  requests: MupdfRequest[] = [];
  cancels: number[] = [];
  transfers: Transferable[][] = [];
  hold = false;
  private held: Array<() => void> = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;

  postMessage(msg: ClientMessage, transfer: Transferable[] = []): void {
    if (msg.kind === 'cancel') {
      this.cancels.push(msg.id);
      return;
    }
    this.requests.push(msg.req);
    this.transfers.push(transfer);
    const deliver = () => this.reply({ kind: 'result', id: msg.id, result: this.respond(msg.req) });
    if (this.hold) this.held.push(deliver);
    else queueMicrotask(deliver);
  }

  flush(): void {
    const all = this.held;
    this.held = [];
    for (const d of all) d();
  }

  reply(msg: WorkerMessage): void {
    this.onmessage?.({ data: msg });
  }

  terminate(): void {}

  count(op: MupdfRequest['op']): number {
    return this.requests.filter((r) => r.op === op).length;
  }

  private respond(req: MupdfRequest): unknown {
    switch (req.op) {
      case 'open':
        return { docId: 7, pageCount: 2 };
      case 'close':
        return { closed: true };
      case 'pageInfo':
        return {
          baseRotation: 0,
          viewBox: [0, 0, 595, 842],
          bounds: [0, 0, 595, 842],
          pageTransform: [1, 0, 0, -1, 0, 842],
        };
      case 'render':
        return {
          pixels: new Uint8ClampedArray([
            10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
          ]).buffer,
          width: 2,
          height: 2,
        };
      case 'textLines':
        return { lines: LINES };
      case 'replaceText':
        return { bytes: new Uint8Array(SAVED).buffer };
      case 'imageList':
        return { images: IMAGES };
      case 'imageEdit':
        return { bytes: new Uint8Array(SAVED).buffer };
    }
  }
}

let port: FakeWorkerPort;

function load(url = '/doc') {
  return loadPdfMupdf(url, new MupdfRpc(port));
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })));
}

function stubCanvas2d() {
  const putImageData = vi.fn();
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    putImageData,
  } as unknown as CanvasRenderingContext2D);
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
  return { canvas, putImageData };
}

beforeEach(() => {
  port = new FakeWorkerPort();
  stubFetch();
});

describe('loadPdfMupdf', () => {
  it('opens the document in the worker, transferring the bytes', async () => {
    const pdf = await load('/api/v1/documents/x');
    expect(pdf.pageCount).toBe(2);
    expect(canEditText(pdf)).toBe(true);
    expect(port.requests[0].op).toBe('open');
    const bytes = (port.requests[0] as { bytes: ArrayBuffer }).bytes;
    expect(port.transfers[0]).toEqual([bytes]);
  });

  it('rejects when the fetch fails (no worker request made)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(load('/missing')).rejects.toThrow('404');
    expect(port.requests).toHaveLength(0);
  });
});

describe('page geometry', () => {
  it('exposes viewBox, rotation and rotated base sizes', async () => {
    const pdf = await load();
    const page = await pdf.page(1);
    expect(page.n).toBe(1);
    expect(page.baseRotation).toBe(0);
    expect(page.viewBox).toEqual([0, 0, 595, 842]);
    expect(page.baseSize()).toEqual({ width: 595, height: 842 });
    expect(page.baseSize(90)).toEqual({ width: 842, height: 595 });
    expect(page.viewportParams(2, 90)).toEqual({ rotation: 90, scale: 2, viewBox: [0, 0, 595, 842] });
  });

  it('caches page handles and rejects out-of-range pages without rpc calls', async () => {
    const pdf = await load();
    const a = await pdf.page(1);
    const b = await pdf.page(1);
    expect(a).toBe(b);
    expect(port.count('pageInfo')).toBe(1);
    await expect(pdf.page(3)).rejects.toThrow('out of range');
    expect(port.count('pageInfo')).toBe(1);
  });
});

describe('render', () => {
  it('blits the transferred RGBA pixels into the canvas', async () => {
    const pdf = await load();
    const page = await pdf.page(1);
    const { canvas, putImageData } = stubCanvas2d();

    await page.render(canvas, 1);
    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(2);
    expect(canvas.style.width).toBe('595px');
    expect(putImageData).toHaveBeenCalledTimes(1);
    const img = putImageData.mock.calls[0][0] as { data: Uint8ClampedArray };
    expect(Array.from(img.data.slice(0, 8))).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    const req = port.requests.find((r) => r.op === 'render') as { scale: number };
    expect(req.scale).toBe(1); // jsdom devicePixelRatio = 1
  });

  it('supersedes an in-flight render on the same canvas (cancel, no draw)', async () => {
    const pdf = await load();
    const page = await pdf.page(1);
    const { canvas, putImageData } = stubCanvas2d();

    port.hold = true;
    const first = page.render(canvas, 1);
    const second = page.render(canvas, 2);
    port.flush();
    await expect(first).resolves.toBeUndefined(); // cancelled silently, like pdf.js
    await expect(second).resolves.toBeUndefined();
    expect(port.cancels).toHaveLength(1);
    expect(putImageData).toHaveBeenCalledTimes(1); // only the second drew
  });

  it('does not cancel renders targeting a different canvas', async () => {
    const pdf = await load();
    const page = await pdf.page(1);
    const a = stubCanvas2d();
    const b = stubCanvas2d();

    port.hold = true;
    const ra = page.render(a.canvas, 1);
    const rb = page.render(b.canvas, 1);
    port.flush();
    await Promise.all([ra, rb]);
    expect(port.cancels).toHaveLength(0);
    expect(a.putImageData).toHaveBeenCalledTimes(1);
    expect(b.putImageData).toHaveBeenCalledTimes(1);
  });

  it('throws when no 2d context is available', async () => {
    const pdf = await load();
    const page = await pdf.page(1);
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    await expect(page.render(canvas, 1)).rejects.toThrow('canvas 2d context');
  });
});

describe('text layer', () => {
  it('emits absolutely positioned spans compatible with the search-mark contract', async () => {
    const pdf = await load();
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
    const pdf = await load();
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

  it('fetches structured text once per page (cached across calls)', async () => {
    const pdf = await load();
    const page = await pdf.page(1);
    await page.renderTextLayer(document.createElement('div'), 1);
    await page.renderTextLayer(document.createElement('div'), 2);
    expect(await page.text()).toBe('Hello world Second line');
    expect(port.count('textLines')).toBe(1);
  });
});

describe('text editing', () => {
  it('finds the span under a PDF-space (y-up) point', async () => {
    const pdf = await load();
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

  it('replaces a span via the worker and invalidates cached text', async () => {
    const pdf = await load();
    if (!canEditText(pdf)) throw new Error('expected edit capability');
    const page = await pdf.page(1);
    await page.text(); // prime the lines cache
    const span = (await pdf.textSpanAt(1, 100, 730))!;
    const bytes = await pdf.replaceTextSpan(span, 'Replacement');
    expect(Array.from(bytes)).toEqual(SAVED);

    const req = port.requests.find((r) => r.op === 'replaceText') as {
      span: { text: string };
      newText: string;
    };
    expect(req.span.text).toBe('Hello world');
    expect(req.newText).toBe('Replacement');

    // cache invalidated: next text() re-fetches lines
    const before = port.count('textLines');
    await new Promise((r) => setTimeout(r, 0)); // let invalidation settle
    await page.text();
    expect(port.count('textLines')).toBe(before + 1);
  });
});

describe('image editing', () => {
  it('finds the image under a PDF-space (y-up) point and caches the list', async () => {
    const pdf = await load();
    if (!canEditImages(pdf)) throw new Error('expected image edit capability');
    const sel = await pdf.imageAt(1, 200, 600);
    expect(sel).toEqual({ page: 1, index: 0, bbox: [100, 500, 300, 650], width: 40, height: 30 });
    expect(await pdf.imageAt(1, 50, 50)).toBeNull();
    expect(port.count('imageList')).toBe(1); // second hit-test reused the cache
  });

  it('applies a delete via the worker and invalidates the image cache', async () => {
    const pdf = await load();
    if (!canEditImages(pdf)) throw new Error('expected image edit capability');
    const sel = (await pdf.imageAt(1, 200, 600))!;
    const bytes = await pdf.applyImageEdit({ kind: 'delete', sel });
    expect(Array.from(bytes)).toEqual(SAVED);
    const req = port.requests.find((r) => r.op === 'imageEdit') as { page: number; edit: unknown };
    expect(req.page).toBe(1);
    expect(req.edit).toEqual({ kind: 'delete', index: 0 });

    // cache invalidated: the next hit-test re-fetches the image list
    await new Promise((r) => setTimeout(r, 0)); // let invalidation settle
    await pdf.imageAt(1, 200, 600);
    expect(port.count('imageList')).toBe(2);
  });

  it('transfers replacement bytes and forwards the fitted target rect', async () => {
    const pdf = await load();
    if (!canEditImages(pdf)) throw new Error('expected image edit capability');
    const sel = (await pdf.imageAt(1, 200, 600))!;
    const payload = new Uint8Array([7, 7, 7, 7]);
    await pdf.applyImageEdit({ kind: 'replace', sel, bytes: payload, rect: sel.bbox });
    const i = port.requests.findIndex((r) => r.op === 'imageEdit');
    const req = port.requests[i] as { edit: { kind: string; bytes: ArrayBuffer; rect: number[] } };
    expect(req.edit.kind).toBe('replace');
    expect(req.edit.rect).toEqual([100, 500, 300, 650]);
    expect(port.transfers[i]).toEqual([req.edit.bytes]); // bytes moved, not copied
  });

  it('sends the new rect for a move/resize (transform) edit', async () => {
    const pdf = await load();
    if (!canEditImages(pdf)) throw new Error('expected image edit capability');
    const sel = (await pdf.imageAt(1, 200, 600))!;
    await pdf.applyImageEdit({ kind: 'transform', sel, rect: [10, 20, 110, 95] });
    const req = port.requests.find((r) => r.op === 'imageEdit') as { edit: unknown };
    expect(req.edit).toEqual({ kind: 'transform', index: 0, rect: [10, 20, 110, 95] });
  });
});

describe('destroy', () => {
  it('closes the worker-side document and refuses further use', async () => {
    const pdf = await load();
    await pdf.page(1);
    pdf.destroy();
    expect(port.count('close')).toBe(1);
    await expect(pdf.page(1)).rejects.toThrow('destroyed');
    pdf.destroy(); // idempotent
    expect(port.count('close')).toBe(1);
  });
});
