/** Positioned contenteditable overlay for in-place text editing (mupdf
 * engine). Sits exactly over the line's bbox at the current zoom/rotation,
 * prefilled with the line text at the rendered size.
 *
 * Enter commits, Escape cancels, focus loss (click-outside) commits if the
 * text changed and cancels otherwise. While the edit is in flight the line
 * is dimmed under a spinner and input is ignored. */
import { useEffect, useRef } from 'react';
import type { TextSpanInfo } from '../../pdf/engineApi';
import type { ViewportParams } from '../../pdf/coords';
import { normalizeEditedText, overlayPlacement } from '../../pdf/overlay';
import { Icon } from '../shared/Icon';

interface Props {
  span: TextSpanInfo;
  vp: ViewportParams;
  /** edit in flight: redact+redraw in the worker, then the /content save */
  busy: boolean;
  /** called with the normalized replacement (only when it differs) */
  onCommit: (newText: string) => void;
  onCancel: () => void;
}

function cssFamily(family: string): string {
  return family === 'serif' || family === 'monospace' ? family : 'sans-serif';
}

export function InlineTextEdit({ span, vp, busy, onCommit, onCancel }: Props) {
  const inputRef = useRef<HTMLDivElement>(null);

  // Prefill + focus + select-all once on mount; afterwards the div owns its
  // own text (React never re-renders contenteditable children).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.textContent = span.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [span]);

  // Handlers re-close over `busy` each render, so this always sees the
  // current value: input is ignored while the edit is in flight.
  const settle = (commitIfChanged: boolean) => {
    if (busy) return;
    const next = normalizeEditedText(inputRef.current?.textContent ?? '');
    if (commitIfChanged && next !== normalizeEditedText(span.text)) onCommit(next);
    else onCancel();
  };

  const p = overlayPlacement(span.bbox, span.fontSize, vp);

  return (
    <div
      className={`inline-edit${busy ? ' busy' : ''}`}
      style={{
        left: p.left,
        top: p.top,
        width: p.width,
        minHeight: p.height,
        transform: p.angle !== 0 ? `rotate(${p.angle}deg)` : undefined,
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        ref={inputRef}
        className="ie-input"
        role="textbox"
        aria-label="Edit text"
        contentEditable={!busy}
        suppressContentEditableWarning
        style={{
          fontSize: p.fontPx,
          lineHeight: `${p.height}px`,
          fontFamily: cssFamily(span.fontFamily),
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            settle(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            settle(false);
          }
        }}
        onBlur={() => settle(true)}
      />
      {busy && (
        <span className="ie-spinner" role="status" aria-label="Saving edit">
          <Icon name="loader" size={Math.min(18, Math.max(12, p.height - 4))} className="spin" />
        </span>
      )}
    </div>
  );
}
