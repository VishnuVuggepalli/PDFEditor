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
import { replaceTextInPage } from './mupdfEdit';
import { applyImageEdit, readPageImages } from './mupdfImageEdit';
import { readPageInfo, readTextLines, renderPageRgba } from './mupdfPageOps';

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
      return { result: readPageInfo(page), transfer: [] };
    }

    case 'render': {
      const mu = await loadMupdf();
      const page = getPage(getDoc(req.docId), req.page);
      // fitz page space already includes /Rotate; only the pending delta rotates.
      const { pixels, width, height } = renderPageRgba(mu, page, req.scale, req.extraRotation);
      return { result: { pixels: pixels.buffer, width, height }, transfer: [pixels.buffer] };
    }

    case 'textLines': {
      const page = getPage(getDoc(req.docId), req.page);
      return { result: { lines: readTextLines(page) }, transfer: [] };
    }

    case 'replaceText': {
      const mu = mupdfSync();
      const entry = getDoc(req.docId);
      const { bytes, font } = replaceTextInPage(
        mu,
        entry.doc,
        getPage(entry, req.span.page),
        req.span,
        req.newText,
      );
      return { result: { bytes: bytes.buffer, font }, transfer: [bytes.buffer] };
    }

    case 'imageList': {
      const page = getPage(getDoc(req.docId), req.page);
      return { result: { images: readPageImages(page) }, transfer: [] };
    }

    case 'imageEdit': {
      const mu = mupdfSync();
      const entry = getDoc(req.docId);
      const bytes = applyImageEdit(mu, entry.doc, getPage(entry, req.page), req.edit);
      return { result: { bytes: bytes.buffer }, transfer: [bytes.buffer] };
    }
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
