/** Pure, immutable pending-operation queue logic for the editor.
 * Page identity is the page's 1-based number in the HEAD version (origN);
 * all transforms return new arrays/objects, never mutate. */

import type {
  AnnotationInput,
  AnnotationType,
  NewFormFieldInput,
  PageOp,
} from '../types/document';
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
  /** text only: core-14 font token composed from family + bold/italic */
  readonly font?: string;
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

/** One queued AcroForm field to create (posted to /form/fields on save,
 * before page ops — field pages reference head-version numbering). */
export interface PendingFormField {
  readonly id: string;
  readonly type: 'text' | 'checkbox';
  /** field name (/T), editable inline until saved */
  readonly name: string;
  /** page number in the saved head version */
  readonly page: number;
  /** placement rect in PDF points, lower-left origin */
  readonly rect: PdfRect;
  readonly multiline?: boolean;
}

/** First "field_N" not colliding with existing or pending field names. */
export function nextFieldName(taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const name = `field_${n}`;
    if (!taken.has(name)) return name;
  }
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
  fields: ReadonlyArray<PendingFormField> = [],
): number {
  const rotated = pages.filter((p) => !p.deleted && p.rotDelta !== 0).length;
  const deleted = pages.filter((p) => p.deleted).length;
  return (
    rotated + deleted + (orderChanged(pages) ? 1 : 0) + annots.length + stamps.length + fields.length
  );
}

/** True for annotations worth saving: everything except text annotations
 * that were left empty (created then never typed into). */
function isSavableAnnotation(a: PendingAnnotation): boolean {
  return a.type !== 'text' || (a.contents ?? '').trim() !== '';
}

/** Head-version page numbers pending deletion. */
export function deletedPageNumbers(pages: ReadonlyArray<EditorPage>): Set<number> {
  return new Set(pages.filter((p) => p.deleted).map((p) => p.origN));
}

/** Count savable annotations and stamps that target pages pending deletion.
 * They would be destroyed by the page delete in the same save, so the editor
 * asks for confirmation before discarding them. */
export function countAnnotsOnDeletedPages(
  pages: ReadonlyArray<EditorPage>,
  annots: ReadonlyArray<PendingAnnotation>,
  stamps: ReadonlyArray<PendingStamp> = [],
  fields: ReadonlyArray<PendingFormField> = [],
): number {
  const deleted = deletedPageNumbers(pages);
  if (deleted.size === 0) return 0;
  return (
    annots.filter((a) => deleted.has(a.page) && isSavableAnnotation(a)).length +
    stamps.filter((s) => deleted.has(s.page)).length +
    fields.filter((f) => deleted.has(f.page)).length
  );
}

/** Convert pending annotations to the wire format. Text annotations that
 * were left empty (created then never typed into) are dropped. */
export function toAnnotationInputs(
  annots: ReadonlyArray<PendingAnnotation>,
): AnnotationInput[] {
  return annots
    .filter(isSavableAnnotation)
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
      if (a.font) out.font = a.font;
      if (a.bg) out.bg = a.bg;
      if (a.borderWidth !== undefined) out.borderWidth = a.borderWidth;
      if (a.line) out.line = [...a.line];
      return out;
    });
}

/** Convert queued form fields to the wire format (name → field id). */
export function toNewFormFieldInputs(
  fields: ReadonlyArray<PendingFormField>,
): NewFormFieldInput[] {
  return fields.map((f) => {
    const out: NewFormFieldInput = {
      type: f.type,
      id: f.name,
      page: f.page,
      rect: [...f.rect],
    };
    if (f.multiline) out.multiline = true;
    return out;
  });
}

/** Patch for moving a pending annotation by (dx, dy) in PDF points: shifts
 * the rect plus any coordinate payloads (ink strokes, line endpoints) so the
 * whole annotation translates as one unit. */
export function shiftAnnotPatch(
  a: PendingAnnotation,
  dx: number,
  dy: number,
): { rect: PdfRect; paths?: number[][]; line?: number[] } {
  const [llx, lly, urx, ury] = a.rect;
  const out: { rect: PdfRect; paths?: number[][]; line?: number[] } = {
    rect: [llx + dx, lly + dy, urx + dx, ury + dy],
  };
  if (a.paths) {
    out.paths = a.paths.map((p) => p.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)));
  }
  if (a.line) {
    out.line = a.line.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
  }
  return out;
}

/** Corner identifiers for rect resizing. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

const MIN_SIDE_PT = 8;

/** Patch resizing a rect-based annotation by dragging one corner by
 * (dx, dy) in PDF points. The opposite corner stays fixed; both sides are
 * clamped to a minimum so a block can never collapse to nothing. */
export function resizeAnnotPatch(
  a: PendingAnnotation,
  corner: Corner,
  dx: number,
  dy: number,
): { rect: PdfRect } {
  let [llx, lly, urx, ury] = a.rect;
  // PDF y-up: the "n" (top) edge is ury, "s" (bottom) is lly.
  if (corner === 'nw' || corner === 'sw') llx = Math.min(llx + dx, urx - MIN_SIDE_PT);
  if (corner === 'ne' || corner === 'se') urx = Math.max(urx + dx, llx + MIN_SIDE_PT);
  if (corner === 'nw' || corner === 'ne') ury = Math.max(ury + dy, lly + MIN_SIDE_PT);
  if (corner === 'sw' || corner === 'se') lly = Math.min(lly + dy, ury - MIN_SIDE_PT);
  return { rect: [llx, lly, urx, ury] };
}

/** Patch moving one endpoint of a line annotation by (dx, dy) in PDF
 * points; the bounding rect is recomputed with a small padding. */
export function moveLineEndpointPatch(
  a: PendingAnnotation,
  which: 0 | 1,
  dx: number,
  dy: number,
): { rect: PdfRect; line: number[] } {
  const [x1, y1, x2, y2] = a.line ?? [0, 0, 0, 0];
  const line = which === 0 ? [x1 + dx, y1 + dy, x2, y2] : [x1, y1, x2 + dx, y2 + dy];
  const pad = Math.max(2, (a.borderWidth ?? 2) / 2 + 1);
  const rect: PdfRect = [
    Math.min(line[0], line[2]) - pad,
    Math.min(line[1], line[3]) - pad,
    Math.max(line[0], line[2]) + pad,
    Math.max(line[1], line[3]) + pad,
  ];
  return { rect, line };
}
