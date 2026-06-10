import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request, unwrap } from './client';
import { subscribeToasts } from './toastBus';
import type { ToastInput } from './toastBus';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('unwrap', () => {
  it('returns data for a success envelope', async () => {
    const res = jsonResponse({ success: true, data: { id: 'abc' } });
    await expect(unwrap<{ id: string }>(res)).resolves.toEqual({ id: 'abc' });
  });

  it('throws ApiError with the server message on failure envelope', async () => {
    const res = jsonResponse({ success: false, data: null, error: 'document or version not found' }, 404);
    await expect(unwrap(res)).rejects.toMatchObject({
      name: 'ApiError',
      message: 'document or version not found',
      status: 404,
    });
  });

  it('throws on success=false even with HTTP 200', async () => {
    const res = jsonResponse({ success: false, data: null, error: 'nope' }, 200);
    await expect(unwrap(res)).rejects.toBeInstanceOf(ApiError);
  });

  it('throws a clear error for non-JSON bodies', async () => {
    const res = new Response('<html>oops</html>', { status: 502 });
    await expect(unwrap(res)).rejects.toMatchObject({ status: 502 });
  });

  it('throws for JSON that is not an envelope', async () => {
    const res = jsonResponse([1, 2, 3]);
    await expect(unwrap(res)).rejects.toThrow(/malformed response envelope/);
  });
});

describe('request', () => {
  const toasts: ToastInput[] = [];
  let unsub: () => void;

  beforeEach(() => {
    toasts.length = 0;
    unsub = subscribeToasts((t) => toasts.push(t));
  });
  afterEach(() => {
    unsub();
    vi.restoreAllMocks();
  });

  it('unwraps the envelope on success without toasting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [1, 2] })));
    await expect(request<number[]>('/documents')).resolves.toEqual([1, 2]);
    expect(toasts).toHaveLength(0);
  });

  it('raises an error toast and throws on API failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, data: null, error: 'invalid input' }, 400)),
    );
    await expect(request('/documents')).rejects.toMatchObject({ message: 'invalid input' });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].msg).toBe('invalid input');
  });

  it('raises a network-error toast when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(request('/documents')).rejects.toBeInstanceOf(ApiError);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe('Network error');
  });

  it('prefixes paths with /api/v1', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: null }));
    vi.stubGlobal('fetch', fetchMock);
    await request('/documents/xyz/meta');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/documents/xyz/meta', undefined);
  });
});
