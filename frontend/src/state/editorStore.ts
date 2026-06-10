/** Editor UI + pending-change state (zustand). Server state lives in
 * react-query; this store owns what the user is editing right now. */

import { create } from 'zustand';
import {
  deletePage,
  initPages,
  reorderPages,
  restorePage,
  rotatePage,
} from './opsQueue';
import type { EditorPage, PendingAnnotation } from './opsQueue';

export type Tool =
  | 'select'
  | 'highlight'
  | 'comment'
  | 'draw'
  | 'shapes'
  | 'text'
  | 'sign'
  | 'forms';

export type Zoom = number | 'fit-width' | 'fit-page';

interface Snapshot {
  readonly pages: ReadonlyArray<EditorPage>;
  readonly annots: ReadonlyArray<PendingAnnotation>;
}

export interface AnnotStyle {
  readonly color: string;
  readonly width: number;
}

export interface EditorState {
  docId: string | null;
  pages: ReadonlyArray<EditorPage>;
  annots: ReadonlyArray<PendingAnnotation>;
  past: ReadonlyArray<Snapshot>;
  future: ReadonlyArray<Snapshot>;

  tool: Tool;
  zoom: Zoom;
  activePageId: string | null;
  annotStyle: AnnotStyle;

  /** (re)initialize for a document/head version */
  init(docId: string, pageCount: number): void;
  setTool(tool: Tool): void;
  setZoom(zoom: Zoom): void;
  setActivePage(id: string): void;
  setAnnotStyle(patch: Partial<AnnotStyle>): void;

  rotate(id: string, delta: number): void;
  remove(id: string): void;
  restore(id: string): void;
  reorder(from: number, to: number): void;

  addAnnot(a: PendingAnnotation): void;
  updateAnnot(id: string, patch: Partial<Pick<PendingAnnotation, 'contents' | 'color'>>): void;
  removeAnnot(id: string): void;

  undo(): void;
  redo(): void;
  clearPending(): void;
}

const HIGHLIGHT_DEFAULT = '#fde047';

export const useEditorStore = create<EditorState>((set, get) => {
  /** push current pending state onto history and apply the next one */
  function commit(pages: ReadonlyArray<EditorPage>, annots: ReadonlyArray<PendingAnnotation>) {
    const s = get();
    set({
      pages,
      annots,
      past: [...s.past, { pages: s.pages, annots: s.annots }],
      future: [],
    });
  }

  return {
    docId: null,
    pages: [],
    annots: [],
    past: [],
    future: [],
    tool: 'select',
    zoom: 100,
    activePageId: null,
    annotStyle: { color: HIGHLIGHT_DEFAULT, width: 4 },

    init(docId, pageCount) {
      const pages = initPages(pageCount);
      set({
        docId,
        pages,
        annots: [],
        past: [],
        future: [],
        tool: 'select',
        activePageId: pages[0]?.id ?? null,
      });
    },

    setTool: (tool) => set({ tool }),
    setZoom: (zoom) => set({ zoom }),
    setActivePage: (id) => set({ activePageId: id }),
    setAnnotStyle: (patch) => set((s) => ({ annotStyle: { ...s.annotStyle, ...patch } })),

    rotate(id, delta) {
      commit(rotatePage(get().pages, id, delta), get().annots);
    },
    remove(id) {
      const s = get();
      const pages = deletePage(s.pages, id);
      commit(pages, s.annots);
      if (s.activePageId === id) {
        const next = pages.find((p) => !p.deleted);
        if (next) set({ activePageId: next.id });
      }
    },
    restore(id) {
      commit(restorePage(get().pages, id), get().annots);
    },
    reorder(from, to) {
      commit(reorderPages(get().pages, from, to), get().annots);
    },

    addAnnot(a) {
      commit(get().pages, [...get().annots, a]);
    },
    updateAnnot(id, patch) {
      commit(
        get().pages,
        get().annots.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      );
    },
    removeAnnot(id) {
      commit(
        get().pages,
        get().annots.filter((a) => a.id !== id),
      );
    },

    undo() {
      const s = get();
      if (s.past.length === 0) return;
      const prev = s.past[s.past.length - 1];
      set({
        pages: prev.pages,
        annots: prev.annots,
        past: s.past.slice(0, -1),
        future: [...s.future, { pages: s.pages, annots: s.annots }],
      });
    },
    redo() {
      const s = get();
      if (s.future.length === 0) return;
      const next = s.future[s.future.length - 1];
      set({
        pages: next.pages,
        annots: next.annots,
        future: s.future.slice(0, -1),
        past: [...s.past, { pages: s.pages, annots: s.annots }],
      });
    },
    clearPending() {
      set({ annots: [], past: [], future: [] });
    },
  };
});
