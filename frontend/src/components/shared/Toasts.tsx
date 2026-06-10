/** Toast stack. Listens to the toastBus so the API client can raise errors. */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { subscribeToasts } from '../../api/toastBus';
import type { ToastInput } from '../../api/toastBus';
import { Icon } from './Icon';

type PushToast = (t: ToastInput) => void;

const ToastCtx = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastCtx);
}

interface ToastItem extends ToastInput {
  id: string;
  out?: boolean;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback<PushToast>((t) => {
    const id = Math.random().toString(36).slice(2);
    const duration = t.duration ?? 3600;
    setToasts((ts) => [...ts, { id, ...t }]);
    setTimeout(() => setToasts((ts) => ts.map((x) => (x.id === id ? { ...x, out: true } : x))), duration);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), duration + 250);
  }, []);

  useEffect(() => subscribeToasts(push), [push]);

  const remove = (id: string) => setToasts((ts) => ts.filter((x) => x.id !== id));

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type ?? 'success'} ${t.out ? 'out' : ''}`}>
            <span className="ico">
              <Icon name={t.type === 'error' ? 'alert' : 'checkCircle'} size={20} />
            </span>
            <div className="body">
              <div className="t-title">{t.title}</div>
              {t.msg ? <div className="t-msg">{t.msg}</div> : null}
            </div>
            <button
              className="iconbtn t-close"
              style={{ width: 22, height: 22 }}
              onClick={() => remove(t.id)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
