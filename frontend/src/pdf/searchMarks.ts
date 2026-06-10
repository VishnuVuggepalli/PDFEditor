/** Search-match marking for the text layer.
 *
 * Matching runs over the page's joined, whitespace-collapsed text — the
 * same corpus PageHandle.text() produces and the viewer counts matches
 * against — so marks and counts always agree, for both engines. The mupdf
 * engine emits one span per text LINE (pdf.js one per text item), so a
 * phrase crossing a span boundary ("foo\nbar" searched as "foo bar") used
 * to get no mark at all even though it was counted. findMatchSegments maps
 * every corpus match back to per-span character ranges: a match inside one
 * line yields one segment, a match crossing lines yields one segment per
 * line touched, all under the same match index.
 */

/** One contiguous highlight range inside a single text-layer span. */
export interface MarkSegment {
  /** index of the text-layer span (line) the segment belongs to */
  line: number;
  /** character range [start, end) within the span's original text */
  start: number;
  end: number;
  /** page-local index of the match this segment belongs to */
  match: number;
}

/** Map every occurrence of `query` (case-insensitive, non-overlapping —
 * identical semantics to the viewer's match counting) onto per-line
 * character ranges. Whitespace runs and line breaks in the corpus collapse
 * to a single space, mirroring PageHandle.text(). Pure. */
export function findMatchSegments(lineTexts: readonly string[], query: string): MarkSegment[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // Collapsed corpus + per-character origin (null for collapsed separators).
  const chars: string[] = [];
  const origins: Array<{ line: number; idx: number } | null> = [];
  let pendingGap = false;
  lineTexts.forEach((text, line) => {
    for (let idx = 0; idx < text.length; idx++) {
      const ch = text[idx];
      if (/\s/.test(ch)) {
        pendingGap = chars.length > 0;
        continue;
      }
      if (pendingGap) {
        chars.push(' ');
        origins.push(null);
        pendingGap = false;
      }
      chars.push(ch.toLowerCase());
      origins.push({ line, idx });
    }
    pendingGap = chars.length > 0; // line break acts as whitespace
  });
  const corpus = chars.join('');

  const segments: MarkSegment[] = [];
  let match = 0;
  let pos = 0;
  for (;;) {
    const at = corpus.indexOf(q, pos);
    if (at === -1) break;
    // Group the matched characters into one contiguous range per line;
    // collapsed separators inside a line are absorbed by the range.
    let current: MarkSegment | null = null;
    for (let k = at; k < at + q.length; k++) {
      const origin = origins[k];
      if (!origin) continue;
      if (current && current.line === origin.line) {
        current = { line: current.line, start: current.start, end: origin.idx + 1, match };
      } else {
        if (current) segments.push(current);
        current = { line: origin.line, start: origin.idx, end: origin.idx + 1, match };
      }
    }
    if (current) segments.push(current);
    match += 1;
    pos = at + q.length;
  }
  return segments;
}

/** Rebuild each text-layer span's children with <mark class="hl"> elements
 * for `query` matches; `activeMatch` (page-local match index, -1 for none)
 * gets the additional 'active' class. Spans cache their original text in
 * data-t so re-marking after a query change is loss-free. Returns the first
 * mark of the active match (scroll target), or null. */
export function applySearchMarks(
  container: HTMLElement,
  query: string,
  activeMatch: number,
): HTMLElement | null {
  const spans = Array.from(container.querySelectorAll<HTMLElement>(':scope > span'));
  const texts = spans.map((span) => {
    const original = span.dataset.t ?? span.textContent ?? '';
    span.dataset.t = original;
    return original;
  });

  const segmentsByLine = new Map<number, MarkSegment[]>();
  for (const seg of findMatchSegments(texts, query)) {
    const list = segmentsByLine.get(seg.line);
    if (list) list.push(seg);
    else segmentsByLine.set(seg.line, [seg]);
  }

  let activeEl: HTMLElement | null = null;
  spans.forEach((span, line) => {
    const segments = segmentsByLine.get(line);
    const original = texts[line];
    if (!segments) {
      // No matches on this line: restore plain text if it was marked before.
      if (span.childElementCount > 0) span.replaceChildren(document.createTextNode(original));
      return;
    }
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const seg of segments) {
      if (seg.start > pos) frag.appendChild(document.createTextNode(original.slice(pos, seg.start)));
      const mark = document.createElement('mark');
      mark.className = 'hl' + (seg.match === activeMatch ? ' active' : '');
      if (seg.match === activeMatch && !activeEl) activeEl = mark;
      mark.textContent = original.slice(seg.start, seg.end);
      frag.appendChild(mark);
      pos = seg.end;
    }
    if (pos < original.length) frag.appendChild(document.createTextNode(original.slice(pos)));
    span.replaceChildren(frag);
  });
  return activeEl;
}
