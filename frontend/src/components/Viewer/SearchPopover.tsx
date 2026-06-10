import { useEffect, useRef } from 'react';
import { Icon } from '../shared/Icon';

interface Props {
  q: string;
  setQ: (q: string) => void;
  count: number;
  active: number;
  setActive: (n: number) => void;
  onClose: () => void;
}

export function SearchPopover({ q, setQ, count, active, setActive, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const has = q.length > 0 && count > 0;
  function nav(d: number) {
    if (count > 0) setActive((active + d + count) % count);
  }
  return (
    <div
      className="search-pop"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          nav(e.shiftKey ? -1 : 1);
        }
        if (e.key === 'Escape') onClose();
      }}
    >
      <Icon name="search" size={15} style={{ color: 'var(--text-3)' }} />
      <input
        ref={inputRef}
        value={q}
        placeholder="Find in document"
        onChange={(e) => setQ(e.target.value)}
      />
      <span className="cnt">{q ? (has ? `${active + 1} / ${count}` : '0 / 0') : ''}</span>
      <span className="sp-sep"></span>
      <button className="iconbtn" disabled={!has} onClick={() => nav(-1)} aria-label="Previous">
        <Icon name="chevUp" size={16} />
      </button>
      <button className="iconbtn" disabled={!has} onClick={() => nav(1)} aria-label="Next">
        <Icon name="chevDown" size={16} />
      </button>
      <button className="iconbtn" onClick={onClose} aria-label="Close search">
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
