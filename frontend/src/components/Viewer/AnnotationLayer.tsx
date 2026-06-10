/** Per-page annotation overlay: draws pending annotations (stored in PDF
 * points) and captures new ones, converting viewport px → PDF points. */
import { useRef, useState } from 'react';
import {
  pdfPathToViewport,
  pdfRectToViewport,
  pdfToViewportPoint,
  viewportPathToPdf,
  viewportRectToPdf,
  viewportToPdfPoint,
} from '../../pdf/coords';
import type { PdfRect, ViewportParams } from '../../pdf/coords';
import type { PendingAnnotation, PendingFormField, PendingStamp } from '../../state/opsQueue';
import type { AnnotStyle, FieldDraftType, Tool } from '../../state/editorStore';
import { Icon } from '../shared/Icon';
import { NotePins } from './NotePins';
import { TextBox } from './TextBox';

const auid = () => 'an_' + Math.random().toString(36).slice(2, 9);
const NOTE_SIZE_PT = 20;
const HIGHLIGHT_OPACITY = 0.45;
const MIN_LINE_PX = 8;

interface Draft {
  kind: 'highlight' | 'square' | 'circle' | 'line' | 'ink' | 'field';
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
  stamps: ReadonlyArray<PendingStamp>;
  /** queued new form fields on this page (form designer) */
  fields: ReadonlyArray<PendingFormField>;
  /** non-null while the forms tool is placing a new field */
  fieldDraft: FieldDraftType;
  tool: Tool;
  style: AnnotStyle;
  readonly: boolean;
  onAdd: (a: PendingAnnotation) => void;
  onUpdate: (id: string, patch: { contents?: string; rect?: PdfRect }) => void;
  onRemove: (id: string) => void;
  onRemoveStamp: (id: string) => void;
  /** form designer: rect drawn for a new field, in PDF points */
  onAddField: (type: 'text' | 'checkbox', rect: PdfRect) => void;
  onRemoveField: (id: string) => void;
  /** sign tool click: viewport-px location on this page */
  onSign: (at: [number, number]) => void;
}

export function AnnotationLayer(props: Props) {
  const {
    vp, width, height, pageOrigN, annots, stamps, fields, fieldDraft, tool, style, readonly,
    onAdd, onUpdate, onRemove, onRemoveStamp, onAddField, onRemoveField, onSign,
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [editText, setEditText] = useState<string | null>(null);

  const drawTools: Tool[] = ['highlight', 'comment', 'draw', 'shapes', 'text', 'sign'];
  const placingField = tool === 'forms' && fieldDraft != null;
  const active = !readonly && (drawTools.includes(tool) || placingField);

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
      return;
    }
    if (tool === 'text') {
      // preventDefault: the browser's default mousedown focus handling would
      // otherwise blur the box right after our autofocus, and the empty-blur
      // handler would delete it again.
      e.preventDefault();
      const fontPx = style.fontSize * vp.scale;
      const rect = viewportRectToPdf({ x, y, w: fontPx * 4, h: fontPx * 1.4 }, vp);
      const id = auid();
      onAdd({
        id, type: 'text', page: pageOrigN, rect,
        color: style.color, contents: '', fontSize: style.fontSize,
      });
      setEditText(id);
      return;
    }
    if (tool === 'sign') {
      // handled in the click handler — opening the modal on mousedown would
      // let the same gesture's trailing events hit its outside-close hook
      return;
    }
    e.preventDefault();
    const kind: Draft['kind'] = placingField
      ? 'field'
      : tool === 'highlight' ? 'highlight' : tool === 'shapes' ? style.shape : 'ink';
    setDraft({
      kind, sx: x, sy: y, x, y, w: 0, h: 0,
      pts: [[x, y]],
      color: style.color,
      width: style.width,
    });
  }

  function move(e: React.MouseEvent) {
    if (!draft) return;
    const [x, y] = rel(e);
    setDraft((d) => {
      if (!d) return d;
      if (d.kind === 'ink') return { ...d, pts: [...d.pts, [x, y]] };
      if (d.kind === 'line') return { ...d, x, y };
      return {
        ...d,
        x: Math.min(x, d.sx),
        y: Math.min(y, d.sy),
        w: Math.abs(x - d.sx),
        h: Math.abs(y - d.sy),
      };
    });
  }

  function commitInk(d: Draft) {
    if (d.pts.length <= 2) return;
    const flat = viewportPathToPdf(d.pts, vp);
    const xs = d.pts.map((p) => p[0]);
    const ys = d.pts.map((p) => p[1]);
    const rect = viewportRectToPdf(
      {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
        h: Math.max(1, Math.max(...ys) - Math.min(...ys)),
      },
      vp,
    );
    onAdd({ id: auid(), type: 'ink', page: pageOrigN, rect, color: d.color, paths: [flat] });
  }

  function commitLine(d: Draft) {
    if (Math.hypot(d.x - d.sx, d.y - d.sy) < MIN_LINE_PX) return;
    const p1 = viewportToPdfPoint(d.sx, d.sy, vp);
    const p2 = viewportToPdfPoint(d.x, d.y, vp);
    const pad = Math.max(d.width, 2);
    const rect: PdfRect = [
      Math.min(p1[0], p2[0]) - pad,
      Math.min(p1[1], p2[1]) - pad,
      Math.max(p1[0], p2[0]) + pad,
      Math.max(p1[1], p2[1]) + pad,
    ];
    onAdd({
      id: auid(), type: 'line', page: pageOrigN, rect,
      color: d.color, line: [...p1, ...p2], borderWidth: d.width,
    });
  }

  function up() {
    if (!draft) return;
    const minW = width * 0.015;
    const minH = height * 0.006;
    if (draft.kind === 'ink') {
      commitInk(draft);
    } else if (draft.kind === 'line') {
      commitLine(draft);
    } else if (draft.kind === 'field') {
      if (draft.w > minW && draft.h > minH && fieldDraft) {
        const rect = viewportRectToPdf({ x: draft.x, y: draft.y, w: draft.w, h: draft.h }, vp);
        onAddField(fieldDraft, rect);
      }
    } else if (draft.w > minW && draft.h > minH) {
      const rect = viewportRectToPdf({ x: draft.x, y: draft.y, w: draft.w, h: draft.h }, vp);
      if (draft.kind === 'highlight') {
        onAdd({
          id: auid(), type: 'highlight', page: pageOrigN, rect,
          color: draft.color, opacity: HIGHLIGHT_OPACITY,
        });
      } else {
        onAdd({
          id: auid(), type: draft.kind, page: pageOrigN, rect,
          color: draft.color, borderWidth: draft.width,
        });
      }
    }
    setDraft(null);
  }

  /** text box committed: recompute the PDF rect from the rendered size */
  function commitText(id: string, contents: string, size: { w: number; h: number }) {
    const a = annots.find((x) => x.id === id);
    if (!a) return;
    const r = pdfRectToViewport(a.rect, vp);
    const rect = viewportRectToPdf({ x: r.x, y: r.y, w: size.w, h: size.h }, vp);
    onUpdate(id, { contents, rect });
    setEditText(null);
  }

  const toSvgPath = (pts: ReadonlyArray<readonly [number, number]>) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

  const lineEnds = (a: PendingAnnotation): [number, number, number, number] => {
    const l = a.line ?? [0, 0, 0, 0];
    const [x1, y1] = pdfToViewportPoint(l[0], l[1], vp);
    const [x2, y2] = pdfToViewportPoint(l[2], l[3], vp);
    return [x1, y1, x2, y2];
  };

  const byType = (t: PendingAnnotation['type']) => annots.filter((a) => a.type === t);
  const boxKinds: ReadonlyArray<{ type: 'square' | 'circle'; cls: string }> = [
    { type: 'square', cls: 'rect' },
    { type: 'circle', cls: 'ellipse' },
  ];

  return (
    <>
      <div className="annot-render">
        {byType('highlight').map((a) => {
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
        {boxKinds.map(({ type, cls }) =>
          byType(type).map((a) => {
            const r = pdfRectToViewport(a.rect, vp);
            return (
              <div
                key={a.id}
                className={`an-shape ${cls}`}
                style={{
                  left: r.x, top: r.y, width: r.w, height: r.h,
                  borderColor: a.color, borderWidth: a.borderWidth ?? 2,
                }}
              >
                {!readonly && (
                  <button className="an-x" onClick={() => onRemove(a.id)}>
                    <Icon name="close" size={11} />
                  </button>
                )}
              </div>
            );
          }),
        )}
        {stamps.map((s) => {
          const r = pdfRectToViewport(s.rect, vp);
          return (
            <div key={s.id} className="an-stamp" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
              <img src={s.dataUrl} alt="Pending signature" />
              {!readonly && (
                <button className="an-x" onClick={() => onRemoveStamp(s.id)}>
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>
          );
        })}
        {fields.map((f) => {
          const r = pdfRectToViewport(f.rect, vp);
          return (
            <div
              key={f.id}
              className={`an-field ${f.type}`}
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            >
              <span className="an-field-name">{f.name}</span>
              {!readonly && (
                <button className="an-x" onClick={() => onRemoveField(f.id)}>
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>
          );
        })}
        <svg className="an-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {byType('ink').map((a) => (
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
          {byType('line').map((a) => {
            const [x1, y1, x2, y2] = lineEnds(a);
            return (
              <line
                key={a.id}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={a.color}
                strokeWidth={(a.borderWidth ?? 2) * vp.scale}
                strokeLinecap="round"
              />
            );
          })}
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
          {draft && draft.kind === 'line' && (
            <line
              x1={draft.sx} y1={draft.sy} x2={draft.x} y2={draft.y}
              stroke={draft.color}
              strokeWidth={draft.width}
              strokeLinecap="round"
            />
          )}
        </svg>
        {draft && draft.kind === 'highlight' && (
          <div
            className="an-hl draft"
            style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h, background: draft.color }}
          />
        )}
        {draft && draft.kind === 'field' && (
          <div
            className="an-field draft"
            style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }}
          />
        )}
        {draft && (draft.kind === 'square' || draft.kind === 'circle') && (
          <div
            className={`an-shape draft ${draft.kind === 'square' ? 'rect' : 'ellipse'}`}
            style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h, borderColor: draft.color, borderWidth: draft.width }}
          />
        )}
        {!readonly &&
          [...byType('ink'), ...byType('line')].map((a) => {
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
        {byType('text').map((a) => (
          <TextBox
            key={a.id}
            a={a}
            vp={vp}
            readonly={readonly}
            autoFocus={editText === a.id}
            onCommit={commitText}
            onRemove={(id) => {
              onRemove(id);
              if (editText === id) setEditText(null);
            }}
          />
        ))}
        <NotePins
          notes={byType('note')}
          vp={vp}
          readonly={readonly}
          openNote={openNote}
          setOpenNote={setOpenNote}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      </div>

      <div
        ref={ref}
        className={`annot-capture tool-${tool}`}
        style={{ pointerEvents: active ? 'auto' : 'none' }}
        onMouseDown={down}
        onMouseMove={move}
        onMouseUp={up}
        onMouseLeave={up}
        onClick={(e) => {
          if (openNote) setOpenNote(null);
          if (active && tool === 'sign') {
            onSign(rel(e));
          }
        }}
      />
    </>
  );
}
