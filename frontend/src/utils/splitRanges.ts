/** Pure validation + preview logic for the split-document range builder.
 * Rows hold raw input strings so partially-typed values don't explode;
 * validation parses and checks them against the document's page count. */

import type { SplitRange } from '../types/document';

/** One editable from/to row in the split modal. */
export interface RangeRow {
  id: string;
  from: string;
  to: string;
}

export interface RangeValidation {
  /** true when every row parses and is within 1..pageCount */
  ok: boolean;
  /** per-row error message, null for valid rows (parallel to input rows) */
  rowErrors: (string | null)[];
  /** parsed ranges — only meaningful when ok */
  ranges: SplitRange[];
}

function parsePage(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

function rowError(from: number | null, to: number | null, pageCount: number): string | null {
  if (from === null || to === null) return 'Enter page numbers';
  if (from < 1) return 'Pages start at 1';
  if (to > pageCount) return `Document has only ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;
  if (from > to) return '“From” must be ≤ “to”';
  return null;
}

/** Validate all rows against the document's page count. */
export function validateRanges(rows: readonly RangeRow[], pageCount: number): RangeValidation {
  if (rows.length === 0) return { ok: false, rowErrors: [], ranges: [] };
  const rowErrors = rows.map((r) => rowError(parsePage(r.from), parsePage(r.to), pageCount));
  const ok = rowErrors.every((e) => e === null);
  const ranges = ok
    ? rows.map((r) => ({ from: parsePage(r.from) as number, to: parsePage(r.to) as number }))
    : [];
  return { ok, rowErrors, ranges };
}

/** Compact label for one range: "p4" or "p1-3". */
export function rangeLabel(r: SplitRange): string {
  return r.from === r.to ? `p${r.from}` : `p${r.from}-${r.to}`;
}

/** Live preview line, e.g. "creates 2 documents: p1-3, p4-10". */
export function splitPreview(ranges: readonly SplitRange[]): string {
  if (ranges.length === 0) return '';
  const noun = ranges.length === 1 ? 'document' : 'documents';
  return `creates ${ranges.length} ${noun}: ${ranges.map(rangeLabel).join(', ')}`;
}
