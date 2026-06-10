/** Per-page annotation overlay: draws pending annotations (stored in PDF
 * points) and captures new ones, converting viewport px → PDF points. */
import { useRef, useState } from 'react';
import {
  pdfPathToViewport,
  pdfRectToViewport,
  viewportPathToPdf,
  viewportRectToPdf,
} from '../../pdf/coords';
import type { ViewportParams } from '../../pdf/coords';
import type { PendingAnnotation } from '../../state/opsQueue';
import type { AnnotStyle, Tool } from '../../state/editorStore';
import { Icon } from '../shared/Icon';

const auid = () => 'an_' + Math.random().toString(36).slice(2, 9);
const NOTE_SIZE_PT = 20;
const HIGHLIGHT_OPACITY = 0.45;

interface Draft {
  kind: 'highlight' | 'square' | 'ink';
  sx: number;
  sy: number;
  x: number;
  y: number;
  w: number;
  h: number;
  pts: [number, number][];
  color: string;
  width: number;
}

interface Props {
  vp: ViewportParams;
  width: number;
  height: number;
  pageOrigN: number;
  annots: ReadonlyArray<PendingAnnotation>;
  tool: Tool;
  style: AnnotStyle;
  readonly: boolean;
  onAdd: (a: PendingAnnotation) => void;
  onUpdate: (id: string, patch: { contents?: string }) => void;
  onRemove: (id: string) => void;
}

export function AnnotationLayer(props: Props) {
  const { vp, width, height, pageOrigN, annots, tool, style, readonly, onAdd, onUpdate, onRemove } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  const drawTools: Tool[] = ['highlight', 'comment', 'draw', 'shapes'];
  const active = !readonly && drawTools.includes(tool);

  function rel(e: React.MouseEvent): [number, number] {
    const el = ref.current;
    if (!el) return [0, 0];
    const r = el.getBoundingClientRect();
    return [
      Math.max(0, Math.min(width, e.clientX - r.left)),
      Math.max(0, Math.min(height, e.clientY - r.top)),
    ];
  }

  function down(e: React.MouseEvent) {
    if (!active || e.button !== 0) return;
    const [x, y] = rel(e);
    if (tool === 'comment') {
      const half = (NOTE_SIZE_PT / 2) * vp.scale;
      const rect = viewportRectToPdf({ x: x - half, y: y - half, w: half * 2, h: half * 2 }, vp);
      const id = auid();
      onAdd({ id, type: 'note', page: pageOrigN, rect, color: '#fde047', contents: '' });
      setOpenNote(id);
      setNoteText('');
      return;
    }
    e.preventDefault();
    const base: Draft = {
      kind: tool === 'highlight' ? 'highlight' : tool === 'shapes' ? 'square' : 'ink',
      sx: x,
      sy: y,
      x,
      y,
      w: 0,
      h: 0,
      pts: [[x, y]],
      color: style.color,
      width: style.width,
    };
    setDraft(base);
  }

  function move(e: React.MouseEvent) {
    if (!draft) return;
    const [x, y] = rel(e);
    setDraft((d) => {
      if (!d) return d;
      if (d.kind === 'ink') return { ...d, pts: [...d.pts, [x, y]] };
      return {
        ...d,
        x: Math.min(x, d.sx),
        y: Math.min(y, d.sy),
        w: Math.abs(x - d.sx),
        h: Math.abs(y - d.sy),
      };
    });
  }

  function up() {
    if (!draft) return;
    const minW = width * 0.015;
    const minH = height * 0.006;
    if (draft.kind === 'ink') {
      if (draft.pts.length > 2) {
        const flat = viewportPathToPdf(draft.pts, vp);
        const xs = draft.pts.map((p) => p[0]);
        const ys = draft.pts.map((p) => p[1]);
        const rect = viewportRectToPdf(
          {
            x: Math.min(...xs),
            y: Math.min(...ys),
            w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
            h: Math.max(1, Math.max(...ys) - Math.min(...ys)),
          },
          vp,
        );
        onAdd({
          id: auid(),
          type: 'ink',
          page: pageOrigN,
          rect,
          color: draft.color,
          paths: [flat],
        });
      }
    } else if (draft.w > minW && draft.h > minH) {
      const rect = viewportRectToPdf({ x: draft.x, y: draft.y, w: draft.w, h: draft.h }, vp);
      if (draft.kind === 'highlight') {
        onAdd({
          id: auid(),
          type: 'highlight',
          page: pageOrigN,
          rect,
          color: draft.color,
          opacity: HIGHLIGHT_OPACITY,
        });
      } else {
        onAdd({ id: auid(), type: 'square', page: pageOrigN, rect, color: draft.color });
      }
    }
    setDraft(null);
  }

  const toSvgPath = (pts: ReadonlyArray<readonly [number, number]>) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

  const notes = annots.filter((a) => a.type === 'note');

  return (
    <>
      <div className="annot-render">
        {annots
          .filter((a) => a.type === 'highlight')
          .map((a) => {
            const r = pdfRectToViewport(a.rect, vp);
            return (
              <div
                key={a.id}
                className="an-hl"
                style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: a.color }}
              >
                {!readonly && (
                  <button className="an-x" onClick={() => onRemove(a.id)}>
                    <Icon name="close" size={11} />
                  </button>
                )}
              </div>
            );
          })}
        {annots
          .filter((a) => a.type === 'square')
          .map((a) => {
            const r = pdfRectToViewport(a.rect, vp);
            return (
              <div
                key={a.id}
                className="an-shape rect"
                style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderColor: a.color, borderWidth: 2 }}
              >
                {!readonly && (
                  <button className="an-x" onClick={() => onRemove(a.id)}>
                    <Icon name="close" size={11} />
                  </button>
                )}
              </div>
            );
          })}
        <svg className="an-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {annots
            .filter((a) => a.type === 'ink')
            .map((a) => (
              <path
                key={a.id}
                d={(a.paths ?? []).map((p) => toSvgPath(pdfPathToViewport(p, vp))).join(' ')}
                stroke={a.color}
                strokeWidth={2.4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          {draft && draft.kind === 'ink' && (
            <path
              d={toSvgPath(draft.pts)}
              stroke={draft.color}
              strokeWidth={draft.width}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
        {draft && draft.kind === 'highlight' && (
          <div
            className="an-hl draft"
            style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h, background: draft.color }}
          />
        )}
        {draft && draft.kind === 'square' && (
          <div
            className="an-shape draft rect"
            style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h, borderColor: draft.color, borderWidth: draft.width }}
          />
        )}
        {annots
          .filter((a) => a.type === 'ink' && !readonly)
          .map((a) => {
            const r = pdfRectToViewport(a.rect, vp);
            return (
              <button
                key={a.id + '_x'}
                className="an-x floating"
                style={{ left: r.x + r.w, top: r.y }}
                onClick={() => onRemove(a.id)}
              >
                <Icon name="close" size={11} />
              </button>
            );
          })}
      </div>

      <div className="annot-pins">
        {notes.map((a, i) => {
          const r = pdfRectToViewport(a.rect, vp);
          const open = openNote === a.id;
          return (
            <div key={a.id} className="cm-pin" style={{ left: r.x + r.w / 2, top: r.y + r.h / 2 }}>
              <button
                className={'cm-dot' + (open ? ' open' : '')}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenNote(open ? null : a.id);
                  setNoteText(a.contents ?? '');
                }}
              >
                {i + 1}
              </button>
              {open && (
                <div className="cm-pop" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  {readonly ? (
                    <div className="cm-read">{a.contents || <span className="muted">No comment</span>}</div>
                  ) : (
                    <textarea
                      autoFocus
                      value={noteText}
                      placeholder="Add a comment…"
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={3}
                    />
                  )}
                  {!readonly && (
                    <div className="cm-acts">
                      <button
                        className="cm-del"
                        onClick={() => {
                          onRemove(a.id);
                          setOpenNote(null);
                        }}
                      >
                        <Icon name="trash" size={13} />
                        Delete
                      </button>
                      <button
                        className="cm-save"
                        onClick={() => {
                          if (!noteText.trim()) onRemove(a.id);
                          else onUpdate(a.id, { contents: noteText });
                          setOpenNote(null);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        ref={ref}
        className={`annot-capture tool-${tool}`}
        style={{ pointerEvents: active ? 'auto' : 'none' }}
        onMouseDown={down}
        onMouseMove={move}
        onMouseUp={up}
        onMouseLeave={up}
        onClick={() => {
          if (openNote) setOpenNote(null);
        }}
      />
    </>
  );
}
