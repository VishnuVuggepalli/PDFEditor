/** Fetch wrapper for the backend's uniform envelope {success, data, error}.
 * Failures raise an error toast and throw ApiError — never swallowed. */

import { emitToast } from './toastBus';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

function isEnvelope(x: unknown): x is Envelope<unknown> {
  return typeof x === 'object' && x !== null && 'success' in x;
}

/** Parse a response that must carry the JSON envelope; unwrap data. */
export async function unwrap<T>(res: Response): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(`unexpected non-JSON response (HTTP ${res.status})`, res.status);
  }
  if (!isEnvelope(body)) {
    throw new ApiError(`malformed response envelope (HTTP ${res.status})`, res.status);
  }
  if (!res.ok || !body.success) {
    throw new ApiError(body.error || `request failed (HTTP ${res.status})`, res.status);
  }
  return body.data as T;
}

/** JSON request against the API; envelope unwrapped; errors → toast + throw. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error';
    emitToast({ type: 'error', title: 'Network error', msg });
    throw new ApiError(msg, 0);
  }
  try {
    return await unwrap<T>(res);
  } catch (e) {
    if (e instanceof ApiError) {
      emitToast({ type: 'error', title: 'Request failed', msg: e.message });
    }
    throw e;
  }
}

export function requestJSON<T>(path: string, method: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Fetch raw bytes (PDF payloads). Error responses still use the envelope. */
export async function requestBytes(path: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error';
    emitToast({ type: 'error', title: 'Network error', msg });
    throw new ApiError(msg, 0);
  }
  if (!res.ok) {
    let msg = `request failed (HTTP ${res.status})`;
    try {
      const body: unknown = await res.json();
      if (isEnvelope(body) && body.error) msg = body.error;
    } catch {
      // keep generic message
    }
    emitToast({ type: 'error', title: 'Request failed', msg });
    throw new ApiError(msg, res.status);
  }
  return res.arrayBuffer();
}
