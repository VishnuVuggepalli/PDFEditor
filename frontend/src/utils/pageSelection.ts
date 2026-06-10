/** Parser for the optional page-selection input of the append-from modal,
 * e.g. "1,3-5" → [1,3,4,5]. */

/** Parse a comma-separated page selection ("2", "1-3", "1,4-6").
 * Returns null when the input doesn't parse, [] for blank input (= all
 * pages). Duplicates are dropped; the server treats this as a selection in
 * source-document order, so the result is sorted ascending. */
export function parsePageSelection(raw: string): number[] | null {
  const trimmed = raw.trim();
  if (trimmed === '') return [];

  const pages = new Set<number>();
  for (const part of trimmed.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] !== undefined ? Number(m[2]) : from;
    if (from < 1 || to < from) return null;
    // Cap absurd ranges so a typo like "1-999999" can't build a huge array.
    if (to - from > 9999) return null;
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}
