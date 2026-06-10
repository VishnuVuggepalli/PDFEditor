/** One rendered PDF page: canvas + selectable text layer + annotation
 * overlay + search match marks + inline text-edit overlay (mupdf engine). */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageHandle, PdfHandle } from '../../pdf/engine';
import { canEditText, type TextSpanInfo } from '../../pdf/engineApi';
import type { PdfRect, ViewportParams } from '../../pdf/coords';
import { viewportSize, viewportToPdfPoint } from '../../pdf/coords';
import type { EditorPage, PendingAnnotation, PendingStamp } from '../../state/opsQueue';
import type { AnnotStyle, Tool } from '../../state/editorStore';
import { AnnotationLayer } from './AnnotationLayer';
import { InlineTextEdit } from './InlineTextEdit';

interface Props {
  pdf: PdfHandle;
  page: EditorPage;
  targetW: number;
  tool: Tool;
  style: AnnotStyle;
  readonly: boolean;
  annots: ReadonlyArray<PendingAnnotation>;
  stamps: ReadonlyArray<PendingStamp>;
  onAdd: (a: PendingAnnotation) => void;
  onUpdate: (id: string, patch: { contents?: string; rect?: PdfRect }) => void;
  onRemove: (id: string) => void;
  onRemoveStamp: (id: string) => void;
  /** sign tool click: page (head-version numbering), viewport point + params */
  onSign: (page: number, at: [number, number], vp: ViewportParams) => void;
  searchQ: string;
  /** index of the active match within this page, or -1 */
  searchActiveLocal: number;
  registerNode: (id: string, el: HTMLDivElement | null) => void;
  /** receives full edited PDF bytes after an in-place text edit (mupdf
   * engine only); absent or non-editing engines disable the gesture. The
   * promise resolves once the edit is persisted (rejects on save failure,
   * keeping the overlay open for retry). */
  onContentEdited?: (bytes: Uint8Array) => Promise<void>;
}

export function PageView(props: Props) {
  const {
    pdf, page, targetW, tool, style, readonly, annots, stamps,
    onAdd, onUpdate, onRemove, onRemoveStamp, onSign,
    searchQ, searchActiveLocal, registerNode, onContentEdited,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<PageHandle | null>(null);
  const [textEpoch, setTextEpoch] = useState(0);

  const vp: ViewportParams | null = useMemo(() => {
    if (!handle) return null;
    const base = handle.baseSize(page.rotDelta);
    return handle.viewportParams(targetW / base.width, page.rotDelta);
  }, [handle, targetW, page.rotDelta]);

  useEffect(() => {
    let alive = true;
    pdf
      .page(page.origN)
      .then((h) => {
        if (alive) setHandle(h);
      })
      .catch(() => {
        // document was destroyed mid-load (navigation/teardown)
      });
    return () => {
      alive = false;
    };
  }, [pdf, page.origN]);

  // Render canvas + text layer whenever geometry changes.
  useEffect(() => {
    if (!handle || !vp) return;
    let alive = true;
    void (async () => {
      const canvas = canvasRef.current;
      const text = textRef.current;
      if (!canvas || !text) return;
      try {
        await handle.render(canvas, vp.scale, page.rotDelta);
        if (!alive) return;
        await handle.renderTextLayer(text, vp.scale, page.rotDelta);
        if (!alive) return;
        setTextEpoch((n) => n + 1);
      } catch {
        // render cancellations during zoom changes are fine
      }
    })();
    return () => {
      alive = false;
    };
  }, [handle, vp, page.rotDelta]);

  // Search marks: post-process text layer spans.
  useEffect(() => {
    const container = textRef.current;
    if (!container) return;
    const spans = container.querySelectorAll<HTMLElement>(':scope > span');
    let local = 0;
    let activeEl: HTMLElement | null = null;
    const q = searchQ.trim().toLowerCase();
    spans.forEach((span) => {
      const original = span.dataset.t ?? span.textContent ?? '';
      span.dataset.t = original;
      if (!q) {
        if (span.childElementCount > 0) span.replaceChildren(document.createTextNode(original));
        return;
      }
      const lower = original.toLowerCase();
      if (!lower.includes(q)) {
        if (span.childElementCount > 0) span.replaceChildren(document.createTextNode(original));
        return;
      }
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (;;) {
        const idx = lower.indexOf(q, pos);
        if (idx === -1) break;
        if (idx > pos) frag.appendChild(document.createTextNode(original.slice(pos, idx)));
        const mark = document.createElement('mark');
        mark.className = 'hl' + (local === searchActiveLocal ? ' active' : '');
        if (local === searchActiveLocal) activeEl = mark;
        mark.textContent = original.slice(idx, idx + q.length);
        frag.appendChild(mark);
        local += 1;
        pos = idx + q.length;
      }
      if (pos < original.length) frag.appendChild(document.createTextNode(original.slice(pos)));
      span.replaceChildren(frag);
    });
    if (activeEl) (activeEl as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [searchQ, searchActiveLocal, textEpoch]);

  const size = vp ? viewportSize(vp) : { width: targetW, height: targetW * (11 / 8.5) };

  // In-place text edit (mupdf engine): double-click a text line to open a
  // contenteditable overlay over its bbox; Enter commits (redact+redraw in
  // the worker, then save via /content), Escape cancels.
  const [editing, setEditing] = useState<TextSpanInfo | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const editable = !readonly && onContentEdited !== undefined && canEditText(pdf);

  async function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editable || !vp || !canEditText(pdf) || editing) return;
    const host = e.currentTarget.getBoundingClientRect();
    const [px, py] = viewportToPdfPoint(e.clientX - host.left, e.clientY - host.top, vp);
    try {
      const span = await pdf.textSpanAt(page.origN, px, py);
      if (span) setEditing(span);
    } catch {
      // hit-test failures (e.g. document torn down mid-gesture) end the gesture
    }
  }

  async function commitEdit(newText: string) {
    if (!editing || editBusy || !onContentEdited || !canEditText(pdf)) return;
    setEditBusy(true);
    try {
      const bytes = await pdf.replaceTextSpan(editing, newText);
      await onContentEdited(bytes);
      setEditing(null); // saved; the viewer reloads the new head version
    } catch {
      // save errors already raised a toast; keep the overlay open for retry
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div
      ref={(el) => registerNode(page.id, el)}
      className="sheet pdf-sheet"
      style={{ width: size.width, height: size.height }}
      onDoubleClick={editable ? (e) => void onDoubleClick(e) : undefined}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div ref={textRef} className="textLayer" />
      {editing && vp && (
        <InlineTextEdit
          span={editing}
          vp={vp}
          busy={editBusy}
          onCommit={(t) => void commitEdit(t)}
          onCancel={() => {
            if (!editBusy) setEditing(null);
          }}
        />
      )}
      {vp && (
        <AnnotationLayer
          vp={vp}
          width={size.width}
          height={size.height}
          pageOrigN={page.origN}
          annots={annots}
          stamps={stamps}
          tool={tool}
          style={style}
          readonly={readonly}
          onAdd={onAdd}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onRemoveStamp={onRemoveStamp}
          onSign={(at) => onSign(page.origN, at, vp)}
        />
      )}
    </div>
  );
}
