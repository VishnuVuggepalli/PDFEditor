/** Pure, immutable pending-operation queue logic for the editor.
 * Page identity is the page's 1-based number in the HEAD version (origN);
 * all transforms return new arrays/objects, never mutate. */

import type { AnnotationInput, AnnotationType, PageOp } from '../types/document';
import type { PdfRect } from '../pdf/coords';

export interface EditorPage {
  /** stable client id */
  readonly id: string;
  /** 1-based page number in the saved head version */
  readonly origN: number;
  /** pending clockwise rotation delta: 0/90/180/270 */
  readonly rotDelta: number;
  /** pending deletion */
  readonly deleted: boolean;
}

export interface PendingAnnotation {
  readonly id: string;
  readonly type: AnnotationType;
  /** page number in the saved head version */
  readonly page: number;
  /** PDF points, lower-left origin */
  readonly rect: PdfRect;
  readonly color: string;
  readonly contents?: string;
  readonly opacity?: number;
  /** ink strokes, each a flat [x1,y1,x2,y2,...] list in PDF points */
  readonly paths?: ReadonlyArray<ReadonlyArray<number>>;
  /** text only: font size in PDF points */
  readonly fontSize?: number;
  /** text only: optional background color */
  readonly bg?: string;
  /** text/square/circle/line: stroke width */
  readonly borderWidth?: number;
  /** line only: [x1,y1,x2,y2] endpoints in PDF points */
  readonly line?: ReadonlyArray<number>;
}

/** One queued signature-image stamp (posted to /stamp on save, after
 * annotations; each stamp creates its own version). */
export interface PendingStamp {
  readonly id: string;
  /** page number in the saved head version */
  readonly page: number;
  /** placement rect in PDF points, lower-left origin */
  readonly rect: PdfRect;
  /** data: URL used both for overlay preview and for the upload */
  readonly dataUrl: string;
}

export function initPages(pageCount: number): EditorPage[] {
  return Array.from({ length: pageCount }, (_, i) => ({
    id: `p${i + 1}`,
    origN: i + 1,
    rotDelta: 0,
    deleted: false,
  }));
}

export function rotatePage(pages: ReadonlyArray<EditorPage>, id: string, delta: number): EditorPage[] {
  return pages.map((p) =>
    p.id === id ? { ...p, rotDelta: (((p.rotDelta + delta) % 360) + 360) % 360 } : p,
  );
}

export function deletePage(pages: ReadonlyArray<EditorPage>, id: string): EditorPage[] {
  return pages.map((p) => (p.id === id ? { ...p, deleted: true } : p));
}

export function restorePage(pages: ReadonlyArray<EditorPage>, id: string): EditorPage[] {
  return pages.map((p) => (p.id === id ? { ...p, deleted: false } : p));
}

export function reorderPages(pages: ReadonlyArray<EditorPage>, from: number, to: number): EditorPage[] {
  if (from < 0 || from >= pages.length || to < 0 || to >= pages.length || from === to) {
    return [...pages];
  }
  const next = [...pages];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** True when the kept pages are no longer in their original relative order. */
export function orderChanged(pages: ReadonlyArray<EditorPage>): boolean {
  const kept = pages.filter((p) => !p.deleted);
  for (let i = 1; i < kept.length; i++) {
    if (kept[i].origN < kept[i - 1].origN) return true;
  }
  return false;
}

/** Build the server op list (rotate → delete → reorder) from pending state.
 * Rotate and delete reference head-version page numbers; the reorder op is a
 * permutation of 1..k over the pages that remain after deletion. */
export function buildPageOps(pages: ReadonlyArray<EditorPage>): PageOp[] {
  const ops: PageOp[] = [];

  const byDegrees = new Map<number, number[]>();
  for (const p of pages) {
    if (p.deleted || p.rotDelta === 0) continue;
    const list = byDegrees.get(p.rotDelta) ?? [];
    byDegrees.set(p.rotDelta, [...list, p.origN]);
  }
  for (const [degrees, pageNums] of [...byDegrees.entries()].sort((a, b) => a[0] - b[0])) {
    ops.push({ type: 'rotate', pages: [...pageNums].sort((a, b) => a - b), degrees });
  }

  const deleted = pages
    .filter((p) => p.deleted)
    .map((p) => p.origN)
    .sort((a, b) => a - b);
  if (deleted.length > 0) ops.push({ type: 'delete', pages: deleted });

  if (orderChanged(pages)) {
    const kept = pages.filter((p) => !p.deleted);
    // After deletion the remaining pages are renumbered 1..k in origN order.
    const rank = new Map(
      [...kept].sort((a, b) => a.origN - b.origN).map((p, i) => [p.origN, i + 1]),
    );
    ops.push({ type: 'reorder', order: kept.map((p) => rank.get(p.origN) as number) });
  }

  return ops;
}

/** Number badge on the Save button: one unit per pending change. */
export function countPendingOps(
  pages: ReadonlyArray<EditorPage>,
  annots: ReadonlyArray<PendingAnnotation>,
  stamps: ReadonlyArray<PendingStamp> = [],
): number {
  const rotated = pages.filter((p) => !p.deleted && p.rotDelta !== 0).length;
  const deleted = pages.filter((p) => p.deleted).length;
  return rotated + deleted + (orderChanged(pages) ? 1 : 0) + annots.length + stamps.length;
}

/** Convert pending annotations to the wire format. Text annotations that
 * were left empty (created then never typed into) are dropped. */
export function toAnnotationInputs(
  annots: ReadonlyArray<PendingAnnotation>,
): AnnotationInput[] {
  return annots
    .filter((a) => a.type !== 'text' || (a.contents ?? '').trim() !== '')
    .map((a) => {
      const out: AnnotationInput = {
        type: a.type,
        page: a.page,
        rect: [...a.rect],
        color: a.color,
      };
      if (a.contents) out.contents = a.contents;
      if (a.opacity !== undefined) out.opacity = a.opacity;
      if (a.paths) out.paths = a.paths.map((p) => [...p]);
      if (a.fontSize !== undefined) out.fontSize = Math.round(a.fontSize);
      if (a.bg) out.bg = a.bg;
      if (a.borderWidth !== undefined) out.borderWidth = a.borderWidth;
      if (a.line) out.line = [...a.line];
      return out;
    });
}
