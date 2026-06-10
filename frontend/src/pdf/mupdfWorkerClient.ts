/** Owns the single mupdf worker instance. One worker serves every document
 * for the lifetime of the tab (the ~10 MB wasm compiles once); documents are
 * opened/closed inside it via the protocol. Terminated on pagehide and
 * recreated on demand if used again. */

import { MupdfRpc, type RpcPort } from './mupdfProtocol';

let rpc: MupdfRpc | null = null;

/** Adapt a real Worker to the minimal RpcPort surface (the DOM lib types
 * Worker.onmessage with the full MessageEvent, which is not structurally
 * interchangeable with the protocol's narrow handler shape). */
function asPort(worker: Worker): RpcPort {
  const port: RpcPort = {
    postMessage: (msg, transfer = []) => worker.postMessage(msg, transfer),
    terminate: () => worker.terminate(),
    onmessage: null,
    onerror: null,
  };
  worker.onmessage = (e) => port.onmessage?.(e);
  worker.onerror = (e) => port.onerror?.(e);
  return port;
}

export function getMupdfRpc(): MupdfRpc {
  if (!rpc) {
    // Literal `new Worker(new URL(...), { type: 'module' })` so Vite bundles
    // the worker (and the wasm it imports) as its own ES-module chunk.
    const worker = new Worker(new URL('./mupdfWorker.ts', import.meta.url), {
      type: 'module',
      name: 'mupdf',
    });
    rpc = new MupdfRpc(asPort(worker));
    window.addEventListener('pagehide', terminateMupdfWorker, { once: true });
  }
  return rpc;
}

/** App teardown: reject anything in flight and kill the worker. */
export function terminateMupdfWorker(): void {
  if (!rpc) return;
  rpc.terminate();
  rpc = null;
}
