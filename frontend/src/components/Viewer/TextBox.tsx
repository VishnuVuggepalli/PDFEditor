/** Editable pending text annotation: a contentEditable box anchored at the
 * annotation rect's top-left. Commits (or self-deletes when empty) on blur,
 * reporting its rendered size so the PDF rect can be recomputed. */
import { useEffect, useRef } from 'react';
import { pdfRectToViewport } from '../../pdf/coords';
import type { ViewportParams } from '../../pdf/coords';
import type { PendingAnnotation } from '../../state/opsQueue';
import { Icon } from '../shared/Icon';

const FONT_SIZE_FALLBACK = 14;

interface Props {
  a: PendingAnnotation;
  vp: ViewportParams;
  readonly: boolean;
  autoFocus: boolean;
  /** commit edited text + measured size (viewport px) */
  onCommit: (id: string, contents: string, size: { w: number; h: number }) => void;
  onRemove: (id: string) => void;
}

export function TextBox({ a, vp, readonly, autoFocus, onCommit, onRemove }: Props) {
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = editRef.current;
    if (autoFocus && el) {
      el.focus();
      const sel = window.getSelection();
      if (sel) sel.selectAllChildren(el);
    }
    // focus only on mount — re-focusing on later renders would steal the caret
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const r = pdfRectToViewport(a.rect, vp);
  const fontPx = (a.fontSize ?? FONT_SIZE_FALLBACK) * vp.scale;

  function blur() {
    const el = editRef.current;
    if (!el) return;
    const text = el.textContent ?? '';
    if (!text.trim()) {
      onRemove(a.id);
      return;
    }
    onCommit(a.id, text, { w: el.offsetWidth, h: el.offsetHeight });
  }

  return (
    <div
      className="an-text"
      style={{ left: r.x, top: r.y, fontSize: Math.max(6, Math.round(fontPx)), color: a.color }}
    >
      <div
        ref={editRef}
        className="an-text-edit"
        contentEditable={!readonly}
        suppressContentEditableWarning
        data-empty={!a.contents}
        onBlur={blur}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            (e.currentTarget as HTMLDivElement).blur();
          }
        }}
      >
        {a.contents}
      </div>
      {!readonly && (
        <button
          className="an-x"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onRemove(a.id)}
          aria-label="Delete text"
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  );
}
