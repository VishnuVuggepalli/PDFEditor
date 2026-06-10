/** Selection overlay for in-place image editing (mupdf engine, Select
 * tool). Highlights the selected image's bbox at the current zoom/rotation
 * with a floating toolbar: Replace (PNG/JPEG picker), Delete, and — after
 * the box is dragged/corner-resized (axis-aligned only) — Apply/Reset.
 * Escape deselects. While an edit is in flight the box dims under a
 * spinner and input is ignored. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageEditRequest, ImageSelection } from '../../pdf/engineApi';
import type { ViewportParams, ViewportRect } from '../../pdf/coords';
import { pdfRectToViewport, viewportRectToPdf, viewportSize } from '../../pdf/coords';
import {
  moveRect,
  rectsAlmostEqual,
  resizeRect,
  sniffImageFile,
  type RectCorner,
} from '../../pdf/imageEdit';
import { emitToast } from '../../api/toastBus';
import { Icon } from '../shared/Icon';

const CORNERS: RectCorner[] = ['nw', 'ne', 'sw', 'se'];
const TOOLBAR_H = 40;

interface Props {
  sel: ImageSelection;
  vp: ViewportParams;
  /** edit in flight: worker rewrite, then the /content save */
  busy: boolean;
  onApply: (edit: ImageEditRequest) => void;
  onCancel: () => void;
}

export function ImageEditOverlay({ sel, vp, busy, onApply, onCancel }: Props) {
  const original = useMemo(() => pdfRectToViewport(sel.bbox, vp), [sel, vp]);
  const page = useMemo(() => viewportSize(vp), [vp]);
  const [box, setBox] = useState<ViewportRect>(original);
  const [anchor, setAnchor] = useState<ViewportRect>(original);
  const endDrag = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-anchor when the selection or the viewport (zoom/rotation) changes
  // (derived-state reset during render; `original` is memoized per sel/vp).
  if (anchor !== original) {
    setAnchor(original);
    setBox(original);
  }

  // Drop dangling document listeners if we unmount mid-drag.
  useEffect(() => () => endDrag.current?.(), []);

  // Escape deselects (unless an edit is in flight).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [busy, onCancel]);

  const dirty = !rectsAlmostEqual(box, original);

  /** Drag-move / corner-resize via document-level listeners, so the drag
   * keeps tracking when the pointer leaves the (small) box or handle. */
  function startDrag(e: React.MouseEvent, mode: 'move' | RectCorner) {
    if (busy || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag.current?.();
    const startBox = box;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setBox(
        mode === 'move'
          ? moveRect(startBox, dx, dy, page)
          : resizeRect(startBox, mode, dx, dy, page),
      );
    };
    const onUp = () => endDrag.current?.();
    endDrag.current = () => {
      endDrag.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  async function onFilePicked(file: File | undefined) {
    if (!file || busy) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!sniffImageFile(bytes)) {
        emitToast({
          type: 'error',
          title: 'Unsupported image',
          msg: 'Choose a PNG or JPEG file.',
        });
        return;
      }
      onApply({ kind: 'replace', sel, bytes, rect: viewportRectToPdf(box, vp) });
    } catch {
      emitToast({ type: 'error', title: 'Could not read the selected file' });
    }
  }

  return (
    <div
      className={`image-edit${busy ? ' busy' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        className="img-box"
        role="group"
        aria-label="Selected image"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        onMouseDown={(e) => startDrag(e, 'move')}
      >
        {CORNERS.map((c) => (
          <span
            key={c}
            className={`img-handle ${c}`}
            aria-label={`Resize ${c}`}
            onMouseDown={(e) => startDrag(e, c)}
          />
        ))}
        {busy && (
          <span className="img-spinner" role="status" aria-label="Saving image edit">
            <Icon name="loader" size={18} className="spin" />
          </span>
        )}
      </div>
      <div
        className="img-toolbar"
        role="toolbar"
        aria-label="Image actions"
        style={{
          left: box.x,
          top: box.y >= TOOLBAR_H + 4 ? box.y - TOOLBAR_H : box.y + box.h + 8,
        }}
      >
        <button disabled={busy} onClick={() => fileRef.current?.click()} title="Replace image">
          <Icon name="image" size={14} />
          Replace
        </button>
        <button
          disabled={busy}
          onClick={() => onApply({ kind: 'delete', sel })}
          title="Delete image"
        >
          <Icon name="trash" size={14} />
          Delete
        </button>
        {dirty && (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={() => onApply({ kind: 'transform', sel, rect: viewportRectToPdf(box, vp) })}
              title="Apply move/resize"
            >
              <Icon name="check" size={14} />
              Apply
            </button>
            <button disabled={busy} onClick={() => setBox(original)} title="Reset position">
              Reset
            </button>
          </>
        )}
        <button disabled={busy} onClick={onCancel} title="Deselect" aria-label="Deselect image">
          <Icon name="close" size={14} />
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onFilePicked(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
