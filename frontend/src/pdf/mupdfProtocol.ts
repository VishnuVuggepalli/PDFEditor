/** postMessage protocol between the main-thread mupdf engine facade and the
 * mupdf worker. Pure: no DOM, no wasm — the client talks to anything that
 * looks like a Worker (RpcPort), so correlation/cancellation/transfer logic
 * is unit-testable with a fake port.
 *
 * Wire shape: every request carries a monotonically increasing id; the
 * worker answers each request exactly once with result | error | cancelled
 * under the same id. Transferables (PDF bytes in, pixel buffers and saved
 * PDFs out) move by ownership transfer, never structured-clone copy. */

import type { TextSpanInfo } from './engineApi';
import type { Mat } from './mupdfTransforms';

/* ---- structured text lines (subset of mupdf stext JSON we consume) ---- */

export interface StextFont {
  name: string;
  family: string;
  weight: string;
  style: string;
  size: number;
}

export interface StextLine {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  font: StextFont;
}

/* ---- page images (in-place image edit) ---- */

/** One image paint located on a page (fitz display space, y down). */
export interface PageImageInfo {
  /** 0-based position in the page's paint order */
  index: number;
  /** axis-aligned bbox [x0,y0,x1,y1] of the painted image */
  fitzBox: [number, number, number, number];
  /** full CTM mapping the image unit square to fitz display space */
  transform: Mat;
  /** intrinsic pixel dimensions of the embedded image */
  width: number;
  height: number;
}

/** An in-place image edit. `index` identifies the image by paint order
 * (matching PageImageInfo.index); rects are [llx,lly,urx,ury] in PDF
 * user-space points (y up), the space the insertion fragment draws in. */
export type ImageEditSpec =
  | { kind: 'delete'; index: number }
  | { kind: 'replace'; index: number; bytes: ArrayBuffer; rect: [number, number, number, number] }
  | { kind: 'transform'; index: number; rect: [number, number, number, number] };

/* ---- requests ---- */

export type MupdfRequest =
  | { op: 'open'; bytes: ArrayBuffer }
  | { op: 'close'; docId: number }
  | { op: 'pageInfo'; docId: number; page: number }
  | { op: 'render'; docId: number; page: number; scale: number; extraRotation: number }
  | { op: 'textLines'; docId: number; page: number }
  | { op: 'replaceText'; docId: number; span: TextSpanInfo; newText: string }
  | { op: 'imageList'; docId: number; page: number }
  | { op: 'imageEdit'; docId: number; page: number; edit: ImageEditSpec };

/* ---- results ---- */

export interface OpenResult {
  docId: number;
  pageCount: number;
}

export interface PageInfoResult {
  /** the page's intrinsic /Rotate in degrees, normalized to 0/90/180/270 */
  baseRotation: number;
  /** normalized CropBox/MediaBox [x0,y0,x1,y1] in PDF points */
  viewBox: [number, number, number, number];
  /** page bounds in fitz display space (y down, /Rotate applied) */
  bounds: [number, number, number, number];
  /** PDF user space -> fitz display space */
  pageTransform: Mat;
}

export interface RenderResult {
  /** RGBA pixels, width*height*4 bytes (transferred) */
  pixels: ArrayBuffer;
  width: number;
  height: number;
}

export interface TextLinesResult {
  lines: StextLine[];
}

export interface ReplaceTextResult {
  /** complete edited PDF (transferred) */
  bytes: ArrayBuffer;
  /** font decision applied to the replacement text (null when the edit
   * only deleted text) */
  font: { strategy: 'embedded' | 'base14'; name: string } | null;
}

export interface ImageListResult {
  /** image paints on the page, in paint order */
  images: PageImageInfo[];
}

export interface ImageEditResult {
  /** complete edited PDF (transferred) */
  bytes: ArrayBuffer;
}

/* ---- envelopes ---- */

export type ClientMessage =
  | { kind: 'request'; id: number; req: MupdfRequest }
  | { kind: 'cancel'; id: number };

export type WorkerMessage =
  | { kind: 'result'; id: number; result: unknown }
  | { kind: 'error'; id: number; name: string; message: string }
  | { kind: 'cancelled'; id: number };

/* ---- typed errors ---- */

/** A request failed inside the worker (or the worker itself died). */
export class MupdfWorkerError extends Error {
  /** error name reported by the worker, e.g. 'TypeError' */
  readonly workerErrorName: string;

  constructor(message: string, workerErrorName = 'Error') {
    super(message);
    this.name = 'MupdfWorkerError';
    this.workerErrorName = workerErrorName;
  }
}

/** A request was cancelled before (or while) the worker processed it.
 * Routine during zoom changes — superseded renders land here. */
export class MupdfCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MupdfCancelledError';
  }
}

/* ---- client ---- */

/** The slice of the Worker interface the client needs; a plain object with
 * these members works in tests. */
export interface RpcPort {
  postMessage(message: ClientMessage, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  op: MupdfRequest['op'];
}

/** Request/response correlation over an RpcPort. One instance per worker;
 * shared by every open document. */
export class MupdfRpc {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly port: RpcPort;
  private terminated = false;

  constructor(port: RpcPort) {
    this.port = port;
    port.onmessage = (e) => this.onMessage(e.data);
    port.onerror = (e) => {
      this.failAll(
        new MupdfWorkerError(`mupdf worker crashed${e.message ? `: ${e.message}` : ''}`),
      );
    };
  }

  /** Number of requests awaiting a response (transfer/teardown bookkeeping). */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Send a request; returns its id (for cancel()) and the result promise. */
  request<T>(req: MupdfRequest, transfer: Transferable[] = []): { id: number; promise: Promise<T> } {
    const id = this.nextId++;
    if (this.terminated) {
      return { id, promise: Promise.reject(new MupdfWorkerError('mupdf worker terminated')) };
    }
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, op: req.op });
    });
    this.port.postMessage({ kind: 'request', id, req }, transfer);
    return { id, promise };
  }

  /** request() without the id, for calls that are never cancelled. */
  call<T>(req: MupdfRequest, transfer: Transferable[] = []): Promise<T> {
    return this.request<T>(req, transfer).promise;
  }

  /** Cancel an in-flight request. Its promise rejects immediately with
   * MupdfCancelledError; the worker drops the request if it is still
   * queued, and any late response for this id is discarded. */
  cancel(id: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.port.postMessage({ kind: 'cancel', id });
    p.reject(new MupdfCancelledError(`${p.op} cancelled`));
  }

  /** Tear the worker down: every pending request rejects, the underlying
   * worker is terminated, and future requests reject immediately. */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.failAll(new MupdfWorkerError('mupdf worker terminated'));
    this.port.terminate();
  }

  private failAll(err: Error): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(err);
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const msg = data as WorkerMessage;
    if (typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return; // cancelled locally; drop the late response
    this.pending.delete(msg.id);
    switch (msg.kind) {
      case 'result':
        p.resolve(msg.result);
        break;
      case 'cancelled':
        p.reject(new MupdfCancelledError(`${p.op} cancelled`));
        break;
      case 'error':
        p.reject(new MupdfWorkerError(msg.message || 'mupdf worker error', msg.name));
        break;
    }
  }
}
