/** Portaled kebab menu (never clipped by overflow), from the design. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface KebabItem {
  sep?: boolean;
  label?: string;
  icon?: string;
  danger?: boolean;
  onClick?: () => void;
}

interface Props {
  items: KebabItem[];
  align?: 'left' | 'right';
}

interface Pos {
  left: number;
  top: number;
  width: number;
}

export function Kebab({ items, align = 'right' }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function place() {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const width = 184;
      const estH =
        items.filter((i) => !i.sep).length * 35 + items.filter((i) => i.sep).length * 11 + 10;
      let left = align === 'right' ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = r.bottom + 4;
      if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - 4);
      setPos({ left, top, width });
    }
    place();
    function onDown(e: MouseEvent) {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (menuRef.current && !menuRef.current.contains(t) && btnRef.current && !btnRef.current.contains(t)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align, items]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className="iconbtn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="More"
      >
        <Icon name="kebab" />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="menu"
              style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
              onClick={(e) => e.stopPropagation()}
            >
              {items.map((it, i) =>
                it.sep ? (
                  <div className="sep" key={i} />
                ) : (
                  <button
                    key={i}
                    className={`item ${it.danger ? 'danger' : ''}`}
                    onClick={() => {
                      it.onClick?.();
                      setOpen(false);
                    }}
                  >
                    {it.icon ? <Icon name={it.icon} /> : null}
                    {it.label}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
