import { describe, expect, it } from 'vitest';
import { rangeLabel, splitPreview, validateRanges } from './splitRanges';
import type { RangeRow } from './splitRanges';

const row = (from: string, to: string, id = 'r'): RangeRow => ({ id, from, to });

describe('validateRanges', () => {
  it('accepts in-bounds ranges and parses them', () => {
    const v = validateRanges([row('1', '3'), row('4', '10')], 10);
    expect(v.ok).toBe(true);
    expect(v.rowErrors).toEqual([null, null]);
    expect(v.ranges).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 10 },
    ]);
  });

  it('accepts a single-page range (from === to)', () => {
    const v = validateRanges([row('1', '1')], 5);
    expect(v.ok).toBe(true);
    expect(v.ranges).toEqual([{ from: 1, to: 1 }]);
  });

  it('rejects empty or non-numeric input', () => {
    expect(validateRanges([row('', '3')], 10).rowErrors[0]).toBe('Enter page numbers');
    expect(validateRanges([row('1', 'x')], 10).rowErrors[0]).toBe('Enter page numbers');
    expect(validateRanges([row('1.5', '3')], 10).ok).toBe(false);
    expect(validateRanges([row('-1', '3')], 10).ok).toBe(false);
  });

  it('rejects pages below 1', () => {
    const v = validateRanges([row('0', '3')], 10);
    expect(v.ok).toBe(false);
    expect(v.rowErrors[0]).toBe('Pages start at 1');
  });

  it('rejects pages beyond the page count', () => {
    const v = validateRanges([row('1', '11')], 10);
    expect(v.ok).toBe(false);
    expect(v.rowErrors[0]).toBe('Document has only 10 pages');
    expect(validateRanges([row('1', '2')], 1).rowErrors[0]).toBe('Document has only 1 page');
  });

  it('rejects inverted ranges', () => {
    const v = validateRanges([row('5', '2')], 10);
    expect(v.ok).toBe(false);
    expect(v.rowErrors[0]).toBe('“From” must be ≤ “to”');
  });

  it('flags only the broken row and returns no ranges', () => {
    const v = validateRanges([row('1', '3'), row('9', '20')], 10);
    expect(v.ok).toBe(false);
    expect(v.rowErrors).toEqual([null, 'Document has only 10 pages']);
    expect(v.ranges).toEqual([]);
  });

  it('fails on an empty row list', () => {
    expect(validateRanges([], 10).ok).toBe(false);
  });
});

describe('rangeLabel / splitPreview', () => {
  it('labels single pages and spans', () => {
    expect(rangeLabel({ from: 4, to: 4 })).toBe('p4');
    expect(rangeLabel({ from: 1, to: 3 })).toBe('p1-3');
  });

  it('builds the live preview text', () => {
    expect(splitPreview([])).toBe('');
    expect(splitPreview([{ from: 1, to: 1 }])).toBe('creates 1 document: p1');
    expect(
      splitPreview([
        { from: 1, to: 3 },
        { from: 4, to: 10 },
      ]),
    ).toBe('creates 2 documents: p1-3, p4-10');
  });
});
