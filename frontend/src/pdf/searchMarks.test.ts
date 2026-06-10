/** Pure match-to-segments mapping + DOM mark application. The headline
 * case: a phrase crossing a line boundary (mupdf spans are whole lines)
 * must produce per-line segments under one match index, in agreement with
 * the viewer's joined-text match counting. */
import { describe, expect, it } from 'vitest';
import { applySearchMarks, findMatchSegments } from './searchMarks';

/** The viewer's count algorithm (Viewer.tsx): non-overlapping indexOf scan
 * over the collapsed joined page text. */
function viewerCount(lineTexts: readonly string[], q: string): number {
  const text = lineTexts.join(' ').replace(/\s+/g, ' ').toLowerCase();
  const needle = q.trim().toLowerCase();
  if (!needle) return 0;
  let n = 0;
  let pos = 0;
  for (;;) {
    const idx = text.indexOf(needle, pos);
    if (idx === -1) break;
    n += 1;
    pos = idx + needle.length;
  }
  return n;
}

function matchCount(segs: ReturnType<typeof findMatchSegments>): number {
  return new Set(segs.map((s) => s.match)).size;
}

describe('findMatchSegments', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(findMatchSegments(['Hello world'], '')).toEqual([]);
    expect(findMatchSegments(['Hello world'], '   ')).toEqual([]);
  });

  it('maps a single in-line match to one segment', () => {
    expect(findMatchSegments(['Hello brave world'], 'brave')).toEqual([
      { line: 0, start: 6, end: 11, match: 0 },
    ]);
  });

  it('is case-insensitive and numbers matches in document order', () => {
    expect(findMatchSegments(['aBc abc', 'ABC'], 'abc')).toEqual([
      { line: 0, start: 0, end: 3, match: 0 },
      { line: 0, start: 4, end: 7, match: 1 },
      { line: 1, start: 0, end: 3, match: 2 },
    ]);
  });

  it('maps a phrase crossing a line boundary to one segment per line', () => {
    const segs = findMatchSegments(['ends with foo', 'bar starts'], 'foo bar');
    expect(segs).toEqual([
      { line: 0, start: 10, end: 13, match: 0 },
      { line: 1, start: 0, end: 3, match: 0 },
    ]);
  });

  it('spans three lines under a single match index', () => {
    const segs = findMatchSegments(['aa one', 'two', 'three bb'], 'one two three');
    expect(segs).toEqual([
      { line: 0, start: 3, end: 6, match: 0 },
      { line: 1, start: 0, end: 3, match: 0 },
      { line: 2, start: 0, end: 5, match: 0 },
    ]);
  });

  it('collapses whitespace runs like PageHandle.text() does', () => {
    // double space in the corpus matches a single-space query...
    expect(findMatchSegments(['foo  bar'], 'foo bar')).toEqual([
      { line: 0, start: 0, end: 8, match: 0 },
    ]);
    // ...but a multi-space query matches nothing (viewer counts 0 too)
    expect(findMatchSegments(['foo bar'], 'foo  bar')).toEqual([]);
    expect(viewerCount(['foo bar'], 'foo  bar')).toBe(0);
  });

  it('finds non-overlapping occurrences only', () => {
    const segs = findMatchSegments(['aaaa'], 'aa');
    expect(matchCount(segs)).toBe(2);
    expect(segs).toEqual([
      { line: 0, start: 0, end: 2, match: 0 },
      { line: 0, start: 2, end: 4, match: 1 },
    ]);
  });

  it('ignores empty lines between matched lines', () => {
    const segs = findMatchSegments(['foo', '', 'bar'], 'foo bar');
    expect(segs).toEqual([
      { line: 0, start: 0, end: 3, match: 0 },
      { line: 2, start: 0, end: 3, match: 0 },
    ]);
  });

  it.each([
    [['Hello world', 'world peace'], 'world'],
    [['ends with foo', 'bar starts'], 'foo bar'],
    [['a b', 'c', 'd'], 'b c d'],
    [['repeat repeat', 'repeat'], 'repeat'],
    [['tail', 'head tail', 'head'], 'tail head'],
  ])('match count agrees with the viewer count for %j / %j', (lines, q) => {
    expect(matchCount(findMatchSegments(lines, q))).toBe(viewerCount(lines, q));
  });
});

describe('applySearchMarks', () => {
  function layer(...lineTexts: string[]): HTMLDivElement {
    const container = document.createElement('div');
    for (const t of lineTexts) {
      const span = document.createElement('span');
      span.textContent = t;
      container.appendChild(span);
    }
    return container;
  }

  it('wraps in-line matches in mark.hl and flags the active match', () => {
    const el = layer('say hi and hi again');
    const active = applySearchMarks(el, 'hi', 1);
    const marks = el.querySelectorAll('mark.hl');
    expect(marks).toHaveLength(2);
    expect(marks[0].className).toBe('hl');
    expect(marks[1].className).toBe('hl active');
    expect(active).toBe(marks[1]);
    expect(el.textContent).toBe('say hi and hi again'); // text preserved
  });

  it('marks a cross-line match in both spans; active scroll target is the first', () => {
    const el = layer('ends with foo', 'bar starts');
    const active = applySearchMarks(el, 'foo bar', 0);
    const marks = el.querySelectorAll<HTMLElement>('mark.hl.active');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('foo');
    expect(marks[1].textContent).toBe('bar');
    expect(active).toBe(marks[0]);
  });

  it('clearing the query restores the original span text', () => {
    const el = layer('say hi');
    applySearchMarks(el, 'hi', 0);
    expect(el.querySelectorAll('mark')).toHaveLength(1);
    applySearchMarks(el, '', -1);
    expect(el.querySelectorAll('mark')).toHaveLength(0);
    expect(el.querySelectorAll(':scope > span')[0].textContent).toBe('say hi');
  });

  it('re-marking with a new query starts from the original text (data-t)', () => {
    const el = layer('alpha beta');
    applySearchMarks(el, 'alpha', 0);
    applySearchMarks(el, 'beta', 0);
    const marks = el.querySelectorAll('mark.hl');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('beta');
    expect(el.textContent).toBe('alpha beta');
  });

  it('returns null when no match is active', () => {
    const el = layer('say hi');
    expect(applySearchMarks(el, 'hi', -1)).toBeNull();
    expect(el.querySelectorAll('mark.hl')).toHaveLength(1);
  });
});
