import { createContext, useContext } from 'react';
import type { ToastInput } from '../../api/toastBus';

export type PushToast = (t: ToastInput) => void;

export const ToastCtx = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastCtx);
}
