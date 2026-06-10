import { describe, expect, it } from 'vitest';
import {
  buildPageOps,
  countPendingOps,
  deletePage,
  initPages,
  orderChanged,
  reorderPages,
  restorePage,
  rotatePage,
  toAnnotationInputs,
} from './opsQueue';
import type { PendingAnnotation } from './opsQueue';

describe('initPages', () => {
  it('creates one entry per page with original numbering', () => {
    const pages = initPages(3);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.origN)).toEqual([1, 2, 3]);
    expect(pages.every((p) => p.rotDelta === 0 && !p.deleted)).toBe(true);
  });
});

describe('rotatePage', () => {
  it('is immutable and accumulates modulo 360', () => {
    const pages = initPages(2);
    const r1 = rotatePage(pages, 'p1', 90);
    expect(pages[0].rotDelta).toBe(0); // original untouched
    expect(r1[0].rotDelta).toBe(90);
    const r2 = rotatePage(rotatePage(rotatePage(r1, 'p1', 90), 'p1', 90), 'p1', 90);
    expect(r2[0].rotDelta).toBe(0);
  });

  it('normalizes negative rotation', () => {
    const r = rotatePage(initPages(1), 'p1', -90);
    expect(r[0].rotDelta).toBe(270);
  });
});

describe('delete/restore', () => {
  it('marks and unmarks deletion without mutating', () => {
    const pages = initPages(2);
    const del = deletePage(pages, 'p2');
    expect(del[1].deleted).toBe(true);
    expect(pages[1].deleted).toBe(false);
    const back = restorePage(del, 'p2');
    expect(back[1].deleted).toBe(false);
  });
});

describe('reorderPages', () => {
  it('moves a page and detects order change', () => {
    const pages = initPages(3);
    const moved = reorderPages(pages, 0, 2);
    expect(moved.map((p) => p.origN)).toEqual([2, 3, 1]);
    expect(orderChanged(moved)).toBe(true);
    expect(orderChanged(pages)).toBe(false);
  });

  it('ignores out-of-range indices', () => {
    const pages = initPages(2);
    expect(reorderPages(pages, -1, 5).map((p) => p.origN)).toEqual([1, 2]);
  });
});

describe('buildPageOps', () => {
  it('returns empty for no pending changes', () => {
    expect(buildPageOps(initPages(4))).toEqual([]);
  });

  it('groups rotations by degrees with sorted pages', () => {
    let pages = initPages(4);
    pages = rotatePage(pages, 'p3', 90);
    pages = rotatePage(pages, 'p1', 90);
    pages = rotatePage(pages, 'p2', 180);
    expect(buildPageOps(pages)).toEqual([
      { type: 'rotate', pages: [1, 3], degrees: 90 },
      { type: 'rotate', pages: [2], degrees: 180 },
    ]);
  });

  it('skips rotations on deleted pages and emits delete op', () => {
    let pages = initPages(3);
    pages = rotatePage(pages, 'p2', 90);
    pages = deletePage(pages, 'p2');
    expect(buildPageOps(pages)).toEqual([{ type: 'delete', pages: [2] }]);
  });

  it('expresses reorder as a permutation of post-delete numbering', () => {
    // 4 pages, delete p2, then move the last page to the front:
    // kept origNs in display order: [4, 1, 3] → post-delete ranks 1→1, 3→2, 4→3
    let pages = initPages(4);
    pages = deletePage(pages, 'p2');
    pages = reorderPages(pages, 3, 0);
    expect(buildPageOps(pages)).toEqual([
      { type: 'delete', pages: [2] },
      { type: 'reorder', order: [3, 1, 2] },
    ]);
  });

  it('emits rotate before delete before reorder', () => {
    let pages = initPages(3);
    pages = rotatePage(pages, 'p1', 270);
    pages = deletePage(pages, 'p3');
    pages = reorderPages(pages, 0, 1);
    const ops = buildPageOps(pages);
    expect(ops.map((o) => o.type)).toEqual(['rotate', 'delete', 'reorder']);
    expect(ops[2]).toEqual({ type: 'reorder', order: [2, 1] });
  });
});

describe('countPendingOps', () => {
  it('counts rotations, deletions, reorder and annotations', () => {
    let pages = initPages(4);
    pages = rotatePage(pages, 'p1', 90);
    pages = deletePage(pages, 'p2');
    pages = reorderPages(pages, 2, 3);
    const annots: PendingAnnotation[] = [
      { id: 'a1', type: 'highlight', page: 1, rect: [0, 0, 10, 10], color: '#fde047' },
    ];
    // 1 rotate + 1 delete + 1 reorder + 1 annotation
    expect(countPendingOps(pages, annots)).toBe(4);
  });

  it('is zero for a pristine document', () => {
    expect(countPendingOps(initPages(5), [])).toBe(0);
  });

  it('counts queued signature stamps', () => {
    const stamps = [
      { id: 's1', page: 1, rect: [0, 0, 100, 50] as const, dataUrl: 'data:image/png;base64,AA==' },
      { id: 's2', page: 2, rect: [0, 0, 100, 50] as const, dataUrl: 'data:image/png;base64,AA==' },
    ];
    expect(countPendingOps(initPages(3), [], stamps)).toBe(2);
  });
});

describe('toAnnotationInputs', () => {
  it('maps pending annotations to the wire format', () => {
    const annots: PendingAnnotation[] = [
      {
        id: 'a1',
        type: 'highlight',
        page: 2,
        rect: [10, 20, 110, 40],
        color: '#fde047',
        opacity: 0.45,
      },
      {
        id: 'a2',
        type: 'note',
        page: 1,
        rect: [5, 5, 25, 25],
        color: '#fde047',
        contents: 'check this',
      },
      {
        id: 'a3',
        type: 'ink',
        page: 3,
        rect: [0, 0, 50, 50],
        color: '#ef4444',
        paths: [[1, 2, 3, 4, 5, 6]],
      },
    ];
    const wire = toAnnotationInputs(annots);
    expect(wire).toEqual([
      { type: 'highlight', page: 2, rect: [10, 20, 110, 40], color: '#fde047', opacity: 0.45 },
      { type: 'note', page: 1, rect: [5, 5, 25, 25], color: '#fde047', contents: 'check this' },
      { type: 'ink', page: 3, rect: [0, 0, 50, 50], color: '#ef4444', paths: [[1, 2, 3, 4, 5, 6]] },
    ]);
    // no client-only fields leak
    expect(Object.keys(wire[0])).not.toContain('id');
  });

  it('maps text, circle and line fields', () => {
    const annots: PendingAnnotation[] = [
      {
        id: 't1',
        type: 'text',
        page: 1,
        rect: [10, 700, 200, 730],
        color: '#111827',
        contents: 'hello',
        fontSize: 17.6,
        bg: '#ffffff',
      },
      {
        id: 'c1',
        type: 'circle',
        page: 1,
        rect: [50, 50, 150, 120],
        color: '#2563eb',
        borderWidth: 3,
      },
      {
        id: 'l1',
        type: 'line',
        page: 2,
        rect: [8, 8, 102, 32],
        color: '#16a34a',
        borderWidth: 2,
        line: [10, 10, 100, 30],
      },
    ];
    expect(toAnnotationInputs(annots)).toEqual([
      {
        type: 'text', page: 1, rect: [10, 700, 200, 730], color: '#111827',
        contents: 'hello', fontSize: 18, bg: '#ffffff',
      },
      { type: 'circle', page: 1, rect: [50, 50, 150, 120], color: '#2563eb', borderWidth: 3 },
      {
        type: 'line', page: 2, rect: [8, 8, 102, 32], color: '#16a34a',
        borderWidth: 2, line: [10, 10, 100, 30],
      },
    ]);
  });

  it('drops text annotations that were left empty', () => {
    const annots: PendingAnnotation[] = [
      { id: 't1', type: 'text', page: 1, rect: [0, 0, 10, 10], color: '#111827', contents: '  ', fontSize: 14 },
      { id: 'h1', type: 'highlight', page: 1, rect: [0, 0, 10, 10], color: '#fde047' },
    ];
    const wire = toAnnotationInputs(annots);
    expect(wire).toHaveLength(1);
    expect(wire[0].type).toBe('highlight');
  });
});
