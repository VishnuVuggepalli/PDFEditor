/** Tiny pub/sub so non-React modules (the API client) can raise toasts.
 * The ToastProvider subscribes on mount. */

export interface ToastInput {
  type?: 'success' | 'error';
  title: string;
  msg?: string;
  duration?: number;
}

type Listener = (t: ToastInput) => void;

const listeners = new Set<Listener>();

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitToast(t: ToastInput): void {
  for (const fn of listeners) fn(t);
}
