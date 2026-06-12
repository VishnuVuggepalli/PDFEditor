/** One rendered PDF page: canvas + selectable text layer + annotation
 * overlay + search match marks + inline text-edit overlay (mupdf engine). */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageHandle, PdfHandle } from '../../pdf/engine';
import {
  canEditImages,
  canEditText,
  type ImageEditRequest,
  type ImageSelection,
  type TextSpanInfo,
} from '../../pdf/engineApi';
import type { PdfRect, ViewportParams } from '../../pdf/coords';
import { viewportSize, viewportToPdfPoint } from '../../pdf/coords';
import { applySearchMarks } from '../../pdf/searchMarks';
import type { EditorPage, PendingAnnotation, PendingFormField, PendingStamp } from '../../state/opsQueue';
import type { AnnotStyle, FieldDraftType, Tool } from '../../state/editorStore';
import { AnnotationLayer } from './AnnotationLayer';
import { ImageEditOverlay } from './ImageEditOverlay';
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
  /** queued new form fields on this page (form designer) */
  fields: ReadonlyArray<PendingFormField>;
  /** non-null while the forms tool is placing a new field */
  fieldDraft: FieldDraftType;
  onAdd: (a: PendingAnnotation) => void;
  onUpdate: (id: string, patch: { contents?: string; rect?: PdfRect; paths?: number[][]; line?: number[] }) => void;
  onRemove: (id: string) => void;
  onRemoveStamp: (id: string) => void;
  /** form designer: rect drawn on this page (head-version numbering) */
  onAddField: (page: number, type: 'text' | 'checkbox', rect: PdfRect) => void;
  onRemoveField: (id: string) => void;
  /** sign tool click: page (head-version numbering), viewport point + params */
  onSign: (page: number, at: [number, number], vp: ViewportParams) => void;
  searchQ: string;
  /** index of the active match within this page, or -1 */
  searchActiveLocal: number;
  registerNode: (id: string, el: HTMLDivElement | null) => void;
  /** receives full edited PDF bytes after an in-place text or image edit
   * (mupdf engine only); absent or non-editing engines disable the
   * gestures. `label` names the edit for the success toast. The promise
   * resolves once the edit is persisted (rejects on save failure, keeping
   * the overlay open for retry). */
  onContentEdited?: (bytes: Uint8Array, label?: string) => Promise<void>;
}

export function PageView(props: Props) {
  const {
    pdf, page, targetW, tool, style, readonly, annots, stamps, fields, fieldDraft,
    onAdd, onUpdate, onRemove, onRemoveStamp, onAddField, onRemoveField, onSign,
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

  // Search marks: post-process text layer spans (searchMarks.ts; handles
  // matches that cross line/span boundaries with per-line precise marks).
  useEffect(() => {
    const container = textRef.current;
    if (!container) return;
    const activeEl = applySearchMarks(container, searchQ, searchActiveLocal);
    if (activeEl) activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  // In-place image edit (mupdf engine): with the Select tool, click an
  // image to select it (bounding-box highlight + floating toolbar). Delete/
  // Replace apply immediately; move/resize applies via the Apply button.
  const [imageSel, setImageSel] = useState<ImageSelection | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const imageEditable =
    !readonly && tool === 'select' && onContentEdited !== undefined && canEditImages(pdf);

  // Leaving the Select tool (or swapping documents) drops the selection
  // (derived-state reset during render, not an effect).
  const [selContext, setSelContext] = useState<{ tool: Tool; pdf: PdfHandle }>({ tool, pdf });
  if (selContext.tool !== tool || selContext.pdf !== pdf) {
    setSelContext({ tool, pdf });
    setImageSel(null);
  }

  async function onSelectClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!imageEditable || !vp || !canEditImages(pdf) || imageBusy) return;
    // Part of a double-click (text edit gesture) or while a text edit is
    // open: not an image-select gesture.
    if (e.detail > 1 || editing) return;
    // A click that concludes a text-selection drag is not a select gesture.
    const docSel = window.getSelection();
    if (docSel && !docSel.isCollapsed) return;
    const host = e.currentTarget.getBoundingClientRect();
    const [px, py] = viewportToPdfPoint(e.clientX - host.left, e.clientY - host.top, vp);
    try {
      // Hit a different image to move the selection; empty space deselects.
      setImageSel(await pdf.imageAt(page.origN, px, py));
    } catch {
      // hit-test failures (document torn down mid-gesture) end the gesture
    }
  }

  async function commitImageEdit(edit: ImageEditRequest) {
    if (imageBusy || !onContentEdited || !canEditImages(pdf)) return;
    setImageBusy(true);
    try {
      const bytes = await pdf.applyImageEdit(edit);
      await onContentEdited(bytes, 'Image edit');
      setImageSel(null); // saved; the viewer reloads the new head version
    } catch {
      // save errors already raised a toast; keep the selection for retry
    } finally {
      setImageBusy(false);
    }
  }

  return (
    <div
      ref={(el) => registerNode(page.id, el)}
      className="sheet pdf-sheet"
      style={{ width: size.width, height: size.height }}
      onDoubleClick={editable ? (e) => void onDoubleClick(e) : undefined}
      onClick={imageEditable ? (e) => void onSelectClick(e) : undefined}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div ref={textRef} className="textLayer" />
      {imageSel && vp && (
        <ImageEditOverlay
          sel={imageSel}
          vp={vp}
          busy={imageBusy}
          onApply={(edit) => void commitImageEdit(edit)}
          onCancel={() => {
            if (!imageBusy) setImageSel(null);
          }}
        />
      )}
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
          fields={fields}
          fieldDraft={fieldDraft}
          tool={tool}
          style={style}
          readonly={readonly}
          onAdd={onAdd}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onRemoveStamp={onRemoveStamp}
          onAddField={(type, rect) => onAddField(page.origN, type, rect)}
          onRemoveField={onRemoveField}
          onSign={(at) => onSign(page.origN, at, vp)}
        />
      )}
    </div>
  );
}
