/** Confirm modal from the design. */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useOutside } from './useOutside';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function Modal({
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  danger,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, onCancel, true);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') onConfirm();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onConfirm]);
  return (
    <div className="modal-scrim">
      <div className="modal" ref={ref} role="dialog" aria-modal="true">
        <div className="m-head">
          <div className="m-title">{title}</div>
        </div>
        <div className="m-body">{children}</div>
        <div className="m-foot">
          <button className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="btn primary"
            style={danger ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
