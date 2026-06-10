/** Worker-side tests: the worker module runs in jsdom (its global is duck-
 * typed) with the wasm module mocked, so the queue/cancel drain loop, the
 * document registry, and the redact+redraw edit logic are exercised against
 * the same fakes the old sync engine was tested with. Geometry fixtures
 * match scripts/mupdf-coords.mjs measurements. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, WorkerMessage } from './mupdfProtocol';
import type { TextSpanInfo } from './engineApi';

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

/* ---- worker harness: duck-typed global in jsdom ---- */

interface Posted {
  msg: WorkerMessage;
  transfer: Transferable[];
}

let posted: Posted[];

function send(msg: ClientMessage): void {
  const handler = (self as unknown as { onmessage: ((e: { data: unknown }) => void) | null }).onmessage;
  if (!handler) throw new Error('worker did not register onmessage');
  handler({ data: msg });
}

async function repliesFor(ids: number[]): Promise<Map<number, Posted>> {
  await vi.waitFor(() => {
    const got = new Set(posted.map((p) => p.msg.id));
    if (!ids.every((id) => got.has(id))) throw new Error('replies pending');
  });
  return new Map(posted.map((p) => [p.msg.id, p]));
}

type Req = Extract<ClientMessage, { kind: 'request' }>['req'];

let nextId: number;

async function request(req: Req): Promise<Posted> {
  const id = nextId++;
  send({ kind: 'request', id, req });
  return (await repliesFor([id])).get(id)!;
}

const SPAN: TextSpanInfo = {
  page: 1,
  text: 'Hello world',
  bbox: [72, 714, 272, 746],
  fitzBox: [72, 96, 272, 128],
  fontName: 'Helvetica',
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
  fontStyle: 'normal',
  fontSize: 24,
};

async function openDoc(): Promise<number> {
  const reply = await request({ op: 'open', bytes: new ArrayBuffer(8) });
  expect(reply.msg.kind).toBe('result');
  return (reply.msg as { result: { docId: number } }).result.docId;
}

beforeEach(async () => {
  fakes.current = makeFakes();
  posted = [];
  nextId = 1;
  vi.stubGlobal('postMessage', (msg: WorkerMessage, transfer: Transferable[] = []) => {
    posted.push({ msg, transfer });
  });
  vi.resetModules();
  await import('./mupdfWorker');
});

describe('open/close', () => {
  it('opens a document and reports docId + pageCount', async () => {
    const reply = await request({ op: 'open', bytes: new ArrayBuffer(8) });
    expect(reply.msg).toMatchObject({ kind: 'result', result: { pageCount: 2 } });
  });

  it('close destroys pages and the document; later use errors', async () => {
    const docId = await openDoc();
    await request({ op: 'pageInfo', docId, page: 1 });
    await request({ op: 'close', docId });
    expect(fakes.current!.calls['page.destroy']).toHaveLength(1);
    expect(fakes.current!.calls['doc.destroy']).toHaveLength(1);
    const reply = await request({ op: 'textLines', docId, page: 1 });
    expect(reply.msg).toMatchObject({ kind: 'error' });
    expect((reply.msg as { message: string }).message).toContain('unknown document');
  });
});

describe('pageInfo', () => {
  it('reports rotation, viewBox, fitz bounds and the page transform', async () => {
    const docId = await openDoc();
    const reply = await request({ op: 'pageInfo', docId, page: 1 });
    expect(reply.msg).toMatchObject({
      kind: 'result',
      result: {
        baseRotation: 0,
        viewBox: [0, 0, 595, 842],
        bounds: [0, 0, 595, 842],
        pageTransform: [1, 0, 0, -1, 0, 842],
      },
    });
  });
});

describe('render', () => {
  it('rasterizes via toPixmap, expands RGB to RGBA, transfers the buffer', async () => {
    const docId = await openDoc();
    const reply = await request({ op: 'render', docId, page: 1, scale: 2, extraRotation: 0 });
    expect(reply.msg.kind).toBe('result');
    const res = (reply.msg as { result: { pixels: ArrayBuffer; width: number; height: number } }).result;
    expect(res.width).toBe(2);
    expect(res.height).toBe(2);
    expect(Array.from(new Uint8ClampedArray(res.pixels).slice(0, 8))).toEqual([
      10, 20, 30, 255, 40, 50, 60, 255,
    ]);
    expect(reply.transfer).toEqual([res.pixels]);
    // scale matrix passed straight through (extra rotation 0)
    expect(fakes.current!.calls['toPixmap'][0][0]).toEqual([2, 0, 0, 2, 0, 0]);
    expect(fakes.current!.calls['pixmap.destroy']).toHaveLength(1);
  });
});

describe('cancellation', () => {
  it('skips a queued request whose cancel arrives before it runs', async () => {
    const docId = await openDoc();
    // Two renders queue up; the second is cancelled while the first waits
    // for its drain tick.
    send({ kind: 'request', id: 1010, req: { op: 'render', docId, page: 1, scale: 1, extraRotation: 0 } });
    send({ kind: 'request', id: 1011, req: { op: 'render', docId, page: 1, scale: 2, extraRotation: 0 } });
    send({ kind: 'cancel', id: 1011 });
    const replies = await repliesFor([1010, 1011]);
    expect(replies.get(1010)!.msg.kind).toBe('result');
    expect(replies.get(1011)!.msg).toEqual({ kind: 'cancelled', id: 1011 });
    // only one rasterization happened
    expect(fakes.current!.calls['toPixmap']).toHaveLength(1);
  });
});

describe('textLines', () => {
  it('returns flattened structured-text lines and frees the stext object', async () => {
    const docId = await openDoc();
    const reply = await request({ op: 'textLines', docId, page: 1 });
    const lines = (reply.msg as { result: { lines: Array<{ text: string }> } }).result.lines;
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Second line']);
    expect(fakes.current!.calls['toStructuredText']).toEqual([['preserve-spans']]);
    expect(fakes.current!.calls['stext.destroy']).toHaveLength(1);
  });
});

describe('replaceText', () => {
  it('redacts the span area and appends a content stream drawing the text', async () => {
    const docId = await openDoc();
    const reply = await request({ op: 'replaceText', docId, span: SPAN, newText: 'Replacement' });
    expect(reply.msg.kind).toBe('result');
    const bytes = (reply.msg as { result: { bytes: ArrayBuffer } }).result.bytes;
    expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3, 4]);
    expect(reply.transfer).toEqual([bytes]);

    const calls = fakes.current!.calls;
    expect(calls['createAnnotation']).toEqual([['Redact']]);
    expect(calls['annot.setRect']).toEqual([[[72, 96, 272, 128]]]);
    expect(calls['applyRedactions']).toEqual([[false, 0, 0, 0]]);
    expect(calls['saveToBuffer']).toEqual([['garbage,compress']]);
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
    const docId = await openDoc();
    await request({ op: 'replaceText', docId, span: SPAN, newText: '   ' });
    expect(fakes.current!.calls['applyRedactions']).toHaveLength(1);
    expect(fakes.current!.calls['addStream']).toBeUndefined();
  });
});

describe('errors', () => {
  it('answers with a typed error envelope instead of crashing the worker', async () => {
    const reply = await request({ op: 'pageInfo', docId: 99, page: 1 });
    expect(reply.msg).toMatchObject({ kind: 'error', name: 'Error' });
    expect((reply.msg as { message: string }).message).toContain('unknown document 99');
    // worker still alive: a valid request succeeds afterwards
    const docId = await openDoc();
    expect(docId).toBeGreaterThan(0);
  });
});
