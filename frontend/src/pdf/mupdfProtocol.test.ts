/** Worker protocol client tests against a fake port: request/response
 * correlation, cancellation, transfer bookkeeping, error propagation and
 * teardown. No real Worker (jsdom has none) — the protocol is pure. */
import { describe, expect, it } from 'vitest';
import {
  MupdfCancelledError,
  MupdfRpc,
  MupdfWorkerError,
  type ClientMessage,
  type RpcPort,
  type WorkerMessage,
} from './mupdfProtocol';

class FakePort implements RpcPort {
  posted: Array<{ msg: ClientMessage; transfer: Transferable[] }> = [];
  terminated = 0;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;

  postMessage(msg: ClientMessage, transfer: Transferable[] = []): void {
    this.posted.push({ msg, transfer });
  }

  terminate(): void {
    this.terminated += 1;
  }

  /** Simulate a worker reply. */
  reply(msg: WorkerMessage): void {
    this.onmessage?.({ data: msg });
  }

  requests(): Array<{ id: number; op: string }> {
    return this.posted
      .filter((p) => p.msg.kind === 'request')
      .map((p) => ({ id: p.msg.id, op: (p.msg as { req: { op: string } }).req.op }));
  }
}

function setup() {
  const port = new FakePort();
  const rpc = new MupdfRpc(port);
  return { port, rpc };
}

describe('correlation', () => {
  it('assigns increasing ids and resolves each request by id, out of order', async () => {
    const { port, rpc } = setup();
    const a = rpc.request<{ v: string }>({ op: 'pageInfo', docId: 1, page: 1 });
    const b = rpc.request<{ v: string }>({ op: 'pageInfo', docId: 1, page: 2 });
    expect(b.id).toBeGreaterThan(a.id);
    expect(rpc.pendingCount).toBe(2);

    port.reply({ kind: 'result', id: b.id, result: { v: 'second' } });
    port.reply({ kind: 'result', id: a.id, result: { v: 'first' } });
    await expect(b.promise).resolves.toEqual({ v: 'second' });
    await expect(a.promise).resolves.toEqual({ v: 'first' });
    expect(rpc.pendingCount).toBe(0);
  });

  it('ignores responses for unknown ids and malformed messages', () => {
    const { port, rpc } = setup();
    port.reply({ kind: 'result', id: 999, result: null });
    port.onmessage?.({ data: 'garbage' });
    port.onmessage?.({ data: null });
    expect(rpc.pendingCount).toBe(0);
  });
});

describe('cancellation', () => {
  it('rejects the local promise immediately and notifies the worker', async () => {
    const { port, rpc } = setup();
    const r = rpc.request({ op: 'render', docId: 1, page: 1, scale: 2, extraRotation: 0 });
    rpc.cancel(r.id);
    await expect(r.promise).rejects.toBeInstanceOf(MupdfCancelledError);
    expect(port.posted.at(-1)?.msg).toEqual({ kind: 'cancel', id: r.id });
    expect(rpc.pendingCount).toBe(0);
  });

  it('drops a late response that arrives after cancel', async () => {
    const { port, rpc } = setup();
    const r = rpc.request({ op: 'render', docId: 1, page: 1, scale: 2, extraRotation: 0 });
    rpc.cancel(r.id);
    await expect(r.promise).rejects.toBeInstanceOf(MupdfCancelledError);
    // worker finished the render anyway; the reply must be a no-op
    port.reply({ kind: 'result', id: r.id, result: { pixels: new ArrayBuffer(4) } });
    expect(rpc.pendingCount).toBe(0);
  });

  it('cancel of an unknown/settled id is a no-op (no message sent)', () => {
    const { port, rpc } = setup();
    rpc.cancel(123);
    expect(port.posted).toHaveLength(0);
  });

  it('rejects with MupdfCancelledError when the worker reports cancelled', async () => {
    const { port, rpc } = setup();
    const r = rpc.request({ op: 'render', docId: 1, page: 1, scale: 2, extraRotation: 0 });
    port.reply({ kind: 'cancelled', id: r.id });
    await expect(r.promise).rejects.toBeInstanceOf(MupdfCancelledError);
  });
});

describe('transfer bookkeeping', () => {
  it('passes the transfer list through to postMessage', () => {
    const { port, rpc } = setup();
    const bytes = new ArrayBuffer(16);
    void rpc.request({ op: 'open', bytes }, [bytes]);
    expect(port.posted).toHaveLength(1);
    expect(port.posted[0].transfer).toEqual([bytes]);
    const req = port.posted[0].msg;
    expect(req.kind).toBe('request');
    if (req.kind === 'request') expect(req.req.op).toBe('open');
  });

  it('sends an empty transfer list by default', () => {
    const { port, rpc } = setup();
    void rpc.call({ op: 'close', docId: 1 });
    expect(port.posted[0].transfer).toEqual([]);
  });

  it('transfers replacement image bytes with an imageEdit request', async () => {
    const { port, rpc } = setup();
    const bytes = new ArrayBuffer(32);
    const { id, promise } = rpc.request<{ bytes: ArrayBuffer }>(
      {
        op: 'imageEdit',
        docId: 1,
        page: 2,
        edit: { kind: 'replace', index: 0, bytes, rect: [10, 20, 110, 95] },
      },
      [bytes],
    );
    expect(port.posted[0].transfer).toEqual([bytes]);
    const req = port.posted[0].msg;
    if (req.kind === 'request' && req.req.op === 'imageEdit') {
      expect(req.req.edit).toMatchObject({ kind: 'replace', index: 0 });
    } else {
      throw new Error('expected an imageEdit request envelope');
    }
    const saved = new ArrayBuffer(8);
    port.reply({ kind: 'result', id, result: { bytes: saved } });
    await expect(promise).resolves.toEqual({ bytes: saved });
  });

  it('correlates imageList results like any other request', async () => {
    const { port, rpc } = setup();
    const { id, promise } = rpc.request<{ images: unknown[] }>({
      op: 'imageList',
      docId: 1,
      page: 1,
    });
    expect(port.requests()).toEqual([{ id, op: 'imageList' }]);
    port.reply({ kind: 'result', id, result: { images: [] } });
    await expect(promise).resolves.toEqual({ images: [] });
  });
});

describe('error propagation', () => {
  it('rejects with a typed MupdfWorkerError carrying the worker error name', async () => {
    const { port, rpc } = setup();
    const r = rpc.request({ op: 'pageInfo', docId: 9, page: 1 });
    port.reply({ kind: 'error', id: r.id, name: 'RangeError', message: 'unknown document 9' });
    const err = await r.promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MupdfWorkerError);
    expect((err as MupdfWorkerError).message).toBe('unknown document 9');
    expect((err as MupdfWorkerError).workerErrorName).toBe('RangeError');
  });

  it('fails every pending request when the worker itself errors', async () => {
    const { port, rpc } = setup();
    const a = rpc.request({ op: 'pageInfo', docId: 1, page: 1 });
    const b = rpc.request({ op: 'textLines', docId: 1, page: 1 });
    port.onerror?.({ message: 'wasm OOM' });
    await expect(a.promise).rejects.toThrow(/worker crashed.*wasm OOM/);
    await expect(b.promise).rejects.toBeInstanceOf(MupdfWorkerError);
    expect(rpc.pendingCount).toBe(0);
  });
});

describe('terminate', () => {
  it('rejects pending requests, terminates the port, and refuses new work', async () => {
    const { port, rpc } = setup();
    const r = rpc.request({ op: 'textLines', docId: 1, page: 1 });
    rpc.terminate();
    await expect(r.promise).rejects.toThrow('terminated');
    expect(port.terminated).toBe(1);
    await expect(rpc.call({ op: 'close', docId: 1 })).rejects.toThrow('terminated');
    // no message reached the dead worker for the post-terminate call
    expect(port.posted.filter((p) => p.msg.kind === 'request')).toHaveLength(1);
  });

  it('is idempotent', () => {
    const { port, rpc } = setup();
    rpc.terminate();
    rpc.terminate();
    expect(port.terminated).toBe(1);
  });
});
