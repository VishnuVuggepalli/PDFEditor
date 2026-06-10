import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';

const store = () => useEditorStore.getState();

describe('editorStore', () => {
  beforeEach(() => {
    store().init('doc-1', 3);
  });

  it('initializes pages and resets pending state', () => {
    expect(store().pages).toHaveLength(3);
    expect(store().annots).toHaveLength(0);
    expect(store().activePageId).toBe('p1');
  });

  it('rotate/remove/reorder push history and undo/redo walk it', () => {
    store().rotate('p1', 90);
    store().remove('p2');
    expect(store().pages[0].rotDelta).toBe(90);
    expect(store().pages[1].deleted).toBe(true);
    expect(store().past).toHaveLength(2);

    store().undo();
    expect(store().pages[1].deleted).toBe(false);
    expect(store().pages[0].rotDelta).toBe(90);

    store().redo();
    expect(store().pages[1].deleted).toBe(true);
  });

  it('new edits clear the redo stack', () => {
    store().rotate('p1', 90);
    store().undo();
    expect(store().future).toHaveLength(1);
    store().remove('p3');
    expect(store().future).toHaveLength(0);
  });

  it('moves the active page when it is deleted', () => {
    store().setActivePage('p1');
    store().remove('p1');
    expect(store().activePageId).toBe('p2');
  });

  it('annotations participate in history', () => {
    store().addAnnot({ id: 'a1', type: 'highlight', page: 1, rect: [0, 0, 5, 5], color: '#fde047' });
    expect(store().annots).toHaveLength(1);
    store().updateAnnot('a1', { contents: 'hello' });
    expect(store().annots[0].contents).toBe('hello');
    store().undo();
    expect(store().annots[0].contents).toBeUndefined();
    store().undo();
    expect(store().annots).toHaveLength(0);
  });

  it('clearPending drops annotations and history but keeps view state', () => {
    store().setZoom(150);
    store().addAnnot({ id: 'a1', type: 'note', page: 1, rect: [0, 0, 5, 5], color: '#fde047' });
    store().clearPending();
    expect(store().annots).toHaveLength(0);
    expect(store().past).toHaveLength(0);
    expect(store().zoom).toBe(150);
  });

  it('signature stamps participate in history and clearPending', () => {
    store().addStamp({ id: 's1', page: 2, rect: [10, 10, 110, 60], dataUrl: 'data:image/png;base64,AA==' });
    expect(store().stamps).toHaveLength(1);
    store().undo();
    expect(store().stamps).toHaveLength(0);
    store().redo();
    expect(store().stamps).toHaveLength(1);
    store().removeStamp('s1');
    expect(store().stamps).toHaveLength(0);
    store().undo();
    store().clearPending();
    expect(store().stamps).toHaveLength(0);
  });

  it('updateAnnot can replace the rect (text commit)', () => {
    store().addAnnot({
      id: 't1', type: 'text', page: 1, rect: [0, 0, 50, 20],
      color: '#111827', contents: '', fontSize: 14,
    });
    store().updateAnnot('t1', { contents: 'hi', rect: [0, 0, 80, 24] });
    expect(store().annots[0].contents).toBe('hi');
    expect(store().annots[0].rect).toEqual([0, 0, 80, 24]);
  });
});
