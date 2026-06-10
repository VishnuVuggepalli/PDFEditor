/** One rendered PDF page: canvas + selectable text layer + annotation
 * overlay + search match marks. */
import { useEffect, useRef, useState } from 'react';
import type { PageHandle, PdfHandle } from '../../pdf/engine';
import type { ViewportParams } from '../../pdf/coords';
import { viewportSize } from '../../pdf/coords';
import type { EditorPage, PendingAnnotation } from '../../state/opsQueue';
import type { AnnotStyle, Tool } from '../../state/editorStore';
import { AnnotationLayer } from './AnnotationLayer';

interface Props {
  pdf: PdfHandle;
  page: EditorPage;
  targetW: number;
  tool: Tool;
  style: AnnotStyle;
  readonly: boolean;
  annots: ReadonlyArray<PendingAnnotation>;
  onAdd: (a: PendingAnnotation) => void;
  onUpdate: (id: string, patch: { contents?: string }) => void;
  onRemove: (id: string) => void;
  searchQ: string;
  /** index of the active match within this page, or -1 */
  searchActiveLocal: number;
  registerNode: (id: string, el: HTMLDivElement | null) => void;
}

export function PageView(props: Props) {
  const {
    pdf, page, targetW, tool, style, readonly, annots,
    onAdd, onUpdate, onRemove, searchQ, searchActiveLocal, registerNode,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<PageHandle | null>(null);
  const [vp, setVp] = useState<ViewportParams | null>(null);
  const [textEpoch, setTextEpoch] = useState(0);

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
    if (!handle) return;
    let alive = true;
    const base = handle.baseSize(page.rotDelta);
    const scale = targetW / base.width;
    setVp(handle.viewportParams(scale, page.rotDelta));
    void (async () => {
      const canvas = canvasRef.current;
      const text = textRef.current;
      if (!canvas || !text) return;
      try {
        await handle.render(canvas, scale, page.rotDelta);
        if (!alive) return;
        await handle.renderTextLayer(text, scale, page.rotDelta);
        if (!alive) return;
        setTextEpoch((n) => n + 1);
      } catch {
        // render cancellations during zoom changes are fine
      }
    })();
    return () => {
      alive = false;
    };
  }, [handle, targetW, page.rotDelta]);

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

  return (
    <div
      ref={(el) => registerNode(page.id, el)}
      className="sheet pdf-sheet"
      style={{ width: size.width, height: size.height }}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div ref={textRef} className="textLayer" />
      {vp && (
        <AnnotationLayer
          vp={vp}
          width={size.width}
          height={size.height}
          pageOrigN={page.origN}
          annots={annots}
          tool={tool}
          style={style}
          readonly={readonly}
          onAdd={onAdd}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}
