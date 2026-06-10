import { describe, expect, it } from 'vitest';
import {
  buildPageOps,
  countAnnotsOnDeletedPages,
  countPendingOps,
  deletedPageNumbers,
  deletePage,
  initPages,
  nextFieldName,
  orderChanged,
  reorderPages,
  restorePage,
  rotatePage,
  toAnnotationInputs,
  toNewFormFieldInputs,
} from './opsQueue';
import type { PendingAnnotation, PendingFormField, PendingStamp } from './opsQueue';

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
    const stamps: PendingStamp[] = [
      { id: 's1', page: 1, rect: [0, 0, 100, 50], dataUrl: 'data:image/png;base64,AA==' },
      { id: 's2', page: 2, rect: [0, 0, 100, 50], dataUrl: 'data:image/png;base64,AA==' },
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

describe('countAnnotsOnDeletedPages', () => {
  const annots: PendingAnnotation[] = [
    { id: 'a1', type: 'highlight', page: 1, rect: [0, 0, 10, 10], color: '#fde047' },
    { id: 'a2', type: 'ink', page: 2, rect: [0, 0, 10, 10], color: '#ef4444', paths: [[1, 2, 3, 4]] },
    { id: 'a3', type: 'highlight', page: 3, rect: [0, 0, 10, 10], color: '#fde047' },
  ];
  const stamps: PendingStamp[] = [
    { id: 's1', page: 2, rect: [0, 0, 50, 20], dataUrl: 'data:image/png;base64,x' },
  ];

  it('returns 0 when no pages are pending deletion', () => {
    expect(countAnnotsOnDeletedPages(initPages(3), annots, stamps)).toBe(0);
  });

  it('counts annotations and stamps on pages pending deletion', () => {
    const pages = deletePage(initPages(3), 'p2');
    // a2 (ink on p2) + s1 (stamp on p2); a1/a3 are on kept pages
    expect(countAnnotsOnDeletedPages(pages, annots, stamps)).toBe(2);
  });

  it('counts across multiple deleted pages', () => {
    const pages = deletePage(deletePage(initPages(3), 'p2'), 'p3');
    expect(countAnnotsOnDeletedPages(pages, annots, stamps)).toBe(3);
  });

  it('ignores empty text annotations — they are never saved anyway', () => {
    const pages = deletePage(initPages(3), 'p2');
    const withEmptyText: PendingAnnotation[] = [
      { id: 't1', type: 'text', page: 2, rect: [0, 0, 10, 10], color: '#111827', contents: ' ', fontSize: 14 },
    ];
    expect(countAnnotsOnDeletedPages(pages, withEmptyText, [])).toBe(0);
  });
});

describe('deletedPageNumbers', () => {
  it('returns the head-version numbers of pages pending deletion', () => {
    const pages = deletePage(deletePage(initPages(4), 'p1'), 'p3');
    expect([...deletedPageNumbers(pages)].sort()).toEqual([1, 3]);
  });
});

describe('form designer queue', () => {
  const fields: PendingFormField[] = [
    { id: 'f1', type: 'text', name: 'firstName', page: 1, rect: [10, 10, 110, 30] },
    { id: 'f2', type: 'checkbox', name: 'agree', page: 2, rect: [10, 10, 24, 24] },
    { id: 'f3', type: 'text', name: 'notes', page: 2, rect: [10, 40, 210, 120], multiline: true },
  ];

  describe('nextFieldName', () => {
    it('starts at field_1', () => {
      expect(nextFieldName(new Set())).toBe('field_1');
    });
    it('skips taken names', () => {
      expect(nextFieldName(new Set(['field_1', 'field_2', 'other']))).toBe('field_3');
    });
  });

  describe('toNewFormFieldInputs', () => {
    it('maps queued fields to the wire format (name → id)', () => {
      expect(toNewFormFieldInputs(fields)).toEqual([
        { type: 'text', id: 'firstName', page: 1, rect: [10, 10, 110, 30] },
        { type: 'checkbox', id: 'agree', page: 2, rect: [10, 10, 24, 24] },
        { type: 'text', id: 'notes', page: 2, rect: [10, 40, 210, 120], multiline: true },
      ]);
    });
    it('returns [] for an empty queue', () => {
      expect(toNewFormFieldInputs([])).toEqual([]);
    });
  });

  describe('counting', () => {
    it('counts queued fields as pending ops', () => {
      expect(countPendingOps(initPages(3), [], [], fields)).toBe(3);
    });
    it('counts queued fields on pages pending deletion as doomed', () => {
      const pages = deletePage(initPages(3), 'p2');
      expect(countAnnotsOnDeletedPages(pages, [], [], fields)).toBe(2);
    });
  });
});
