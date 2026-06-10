/** Dedicated worker owning ALL mupdf-WASM execution. The main thread talks
 * to it exclusively through the mupdfProtocol envelopes; pixel buffers and
 * PDF bytes cross the boundary as transferables.
 *
 * Requests drain one per macrotask (not directly in onmessage) so that a
 * 'cancel' for a queued request can be observed before the request runs —
 * that is what makes superseded renders actually skippable while an earlier
 * render is still rasterizing. */

import type * as MU from 'mupdf';
import type { ClientMessage, MupdfRequest, WorkerMessage } from './mupdfProtocol';
import {
  approxBaseline,
  base14FontName,
  buildEditContentStream,
  displayMatrix,
  rgbToRgba,
  stextLines,
  type Mat,
  type StextJson,
} from './mupdfTransforms';
import type { TextSpanInfo } from './engineApi';

type Mupdf = typeof MU;

/* The app tsconfig compiles against the DOM lib; type the worker global
 * with the minimal surface we use instead of pulling in lib.webworker. */
interface WorkerSelf {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(msg: WorkerMessage, transfer?: Transferable[]): void;
}

const ctx = self as unknown as WorkerSelf;

/* ---- wasm module + document registry ---- */

let mupdfLoad: Promise<Mupdf> | null = null;
/** Set once mupdfLoad resolves; sync handlers can only run after 'open'
 * awaited the load, so reading it via mupdfSync() is safe. */
let mupdfModule: Mupdf | null = null;

function loadMupdf(): Promise<Mupdf> {
  mupdfLoad ??= import('mupdf').then((mu) => {
    mupdfModule = mu;
    return mu;
  });
  return mupdfLoad;
}

function mupdfSync(): Mupdf {
  if (!mupdfModule) throw new Error('mupdf not loaded');
  return mupdfModule;
}

// Warm up: overlap wasm fetch+compile with whatever the main thread does next.
void loadMupdf();

interface OpenDoc {
  doc: MU.PDFDocument;
  pages: Map<number, MU.PDFPage>;
}

const docs = new Map<number, OpenDoc>();
let nextDocId = 1;

function getDoc(docId: number): OpenDoc {
  const d = docs.get(docId);
  if (!d) throw new Error(`unknown document ${docId}`);
  return d;
}

function getPage(entry: OpenDoc, n: number): MU.PDFPage {
  let p = entry.pages.get(n);
  if (!p) {
    p = entry.doc.loadPage(n - 1);
    entry.pages.set(n, p);
  }
  return p;
}

/** Read the page's CropBox (fallback MediaBox) as a normalized viewBox. */
function readViewBox(obj: MU.PDFObject): [number, number, number, number] | null {
  for (const key of ['CropBox', 'MediaBox']) {
    const box = obj.getInheritable(key);
    if (box.isArray() && box.length === 4) {
      const v = [0, 1, 2, 3].map((i) => box.get(i).asNumber());
      return [
        Math.min(v[0], v[2]),
        Math.min(v[1], v[3]),
        Math.max(v[0], v[2]),
        Math.max(v[1], v[3]),
      ];
    }
  }
  return null;
}

/* ---- request handlers ---- */

interface Handled {
  result: unknown;
  transfer: Transferable[];
}

async function handle(req: MupdfRequest): Promise<Handled> {
  switch (req.op) {
    case 'open': {
      const mu = await loadMupdf();
      const doc = mu.Document.openDocument(req.bytes, 'application/pdf');
      const pdf = doc.asPDF();
      if (!pdf) {
        doc.destroy();
        throw new Error('not a PDF document');
      }
      const docId = nextDocId++;
      docs.set(docId, { doc: pdf, pages: new Map() });
      return { result: { docId, pageCount: pdf.countPages() }, transfer: [] };
    }

    case 'close': {
      const entry = docs.get(req.docId);
      if (entry) {
        docs.delete(req.docId);
        for (const p of entry.pages.values()) p.destroy();
        entry.doc.destroy();
      }
      return { result: { closed: true }, transfer: [] };
    }

    case 'pageInfo': {
      const page = getPage(getDoc(req.docId), req.page);
      const b = page.getBounds();
      const obj = page.getObject();
      const rotate = obj.getInheritable('Rotate');
      const baseRotation = rotate.isNumber() ? ((rotate.asNumber() % 360) + 360) % 360 : 0;
      return {
        result: {
          baseRotation,
          viewBox: readViewBox(obj) ?? [0, 0, b[2] - b[0], b[3] - b[1]],
          bounds: [b[0], b[1], b[2], b[3]],
          pageTransform: page.getTransform() as Mat,
        },
        transfer: [],
      };
    }

    case 'render': {
      const mu = await loadMupdf();
      const page = getPage(getDoc(req.docId), req.page);
      // fitz page space already includes /Rotate; only the pending delta rotates.
      const m = displayMatrix(req.scale, req.extraRotation);
      const pix = page.toPixmap(m as MU.Matrix, mu.ColorSpace.DeviceRGB, false, true);
      try {
        const width = pix.getWidth();
        const height = pix.getHeight();
        const rgba = rgbToRgba(pix.getPixels(), width, height, pix.getStride());
        return { result: { pixels: rgba.buffer, width, height }, transfer: [rgba.buffer] };
      } finally {
        pix.destroy();
      }
    }

    case 'textLines': {
      const page = getPage(getDoc(req.docId), req.page);
      const st = page.toStructuredText('preserve-spans');
      try {
        const json = JSON.parse(st.asJSON()) as StextJson;
        return { result: { lines: stextLines(json) }, transfer: [] };
      } finally {
        st.destroy();
      }
    }

    case 'replaceText': {
      const bytes = replaceText(getDoc(req.docId), req.span, req.newText);
      return { result: { bytes: bytes.buffer }, transfer: [bytes.buffer] };
    }
  }
}

/** In-place edit: redact the span's region (true content removal), then draw
 * the replacement text via an appended content stream. Returns the complete
 * edited PDF bytes for upload. */
function replaceText(entry: OpenDoc, span: TextSpanInfo, newText: string): Uint8Array {
  const mu = mupdfSync();
  const doc = entry.doc;
  const page = getPage(entry, span.page);

  const annot = page.createAnnotation('Redact');
  annot.setRect(span.fitzBox);
  page.applyRedactions(
    false,
    mu.PDFPage.REDACT_IMAGE_NONE,
    mu.PDFPage.REDACT_LINE_ART_NONE,
    mu.PDFPage.REDACT_TEXT_REMOVE,
  );

  if (newText.trim().length > 0) {
    const fontName = base14FontName(span.fontFamily, 'normal', 'normal');
    const fontRef = doc.addSimpleFont(new mu.Font(fontName));
    const pageObj = page.getObject();
    let res = pageObj.get('Resources');
    if (!res.isDictionary()) {
      res = doc.newDictionary();
      pageObj.put('Resources', res);
    }
    let fonts = res.get('Font');
    if (!fonts.isDictionary()) {
      fonts = doc.newDictionary();
      res.put('Font', fonts);
    }
    let resName = 'FzEdit';
    for (let i = 0; !fonts.get(resName).isNull(); i++) resName = `FzEdit${i}`;
    fonts.put(resName, fontRef);

    const baseline = approxBaseline(span.bbox[1], span.fontSize);
    const fragment = buildEditContentStream(resName, span.fontSize, span.bbox[0], baseline, newText);
    const extra = doc.addStream(fragment, {});
    const contents = pageObj.get('Contents');
    if (contents.isArray()) {
      contents.push(extra);
    } else {
      const arr = doc.newArray();
      arr.push(contents);
      arr.push(extra);
      pageObj.put('Contents', arr);
    }
  }

  const buf = doc.saveToBuffer('garbage,compress');
  try {
    return buf.asUint8Array().slice();
  } finally {
    buf.destroy();
  }
}

/* ---- queue + drain loop ---- */

const queue: Array<{ id: number; req: MupdfRequest }> = [];
/** ids cancelled while still queued. Entries for already-answered ids are
 * rare (client only cancels requests it still has pending) and just sit in
 * the set; ids are never reused so they can never match a later request. */
const cancelled = new Set<number>();
let draining = false;

ctx.onmessage = (e) => {
  const msg = e.data as ClientMessage;
  if (typeof msg !== 'object' || msg === null) return;
  if (msg.kind === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  if (msg.kind === 'request') {
    queue.push({ id: msg.id, req: msg.req });
    if (!draining) {
      draining = true;
      setTimeout(() => void drainOne(), 0);
    }
  }
};

async function drainOne(): Promise<void> {
  const item = queue.shift();
  if (item) {
    if (cancelled.delete(item.id)) {
      ctx.postMessage({ kind: 'cancelled', id: item.id });
    } else {
      try {
        const { result, transfer } = await handle(item.req);
        ctx.postMessage({ kind: 'result', id: item.id, result }, transfer);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        ctx.postMessage({ kind: 'error', id: item.id, name: err.name, message: err.message });
      }
    }
  }
  // One item per macrotask: pending 'cancel' messages get delivered between
  // items, which is the whole point of the queue.
  if (queue.length > 0) setTimeout(() => void drainOne(), 0);
  else draining = false;
}
