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
import type {
  EditorPage,
  PendingAnnotation,
  PendingFormField,
  PendingStamp,
} from './opsQueue';

export type Tool =
  | 'select'
  | 'highlight'
  | 'comment'
  | 'draw'
  | 'shapes'
  | 'text'
  | 'sign'
  | 'forms';

export type ShapeKind = 'square' | 'circle' | 'line';

export type Zoom = number | 'fit-width' | 'fit-page';

interface Snapshot {
  readonly pages: ReadonlyArray<EditorPage>;
  readonly annots: ReadonlyArray<PendingAnnotation>;
  readonly stamps: ReadonlyArray<PendingStamp>;
  readonly fields: ReadonlyArray<PendingFormField>;
}

/** Form-designer placement mode: which field type the next drawn rect creates. */
export type FieldDraftType = 'text' | 'checkbox' | null;

/** Core-14 font family for the text tool. */
export type FontFamily = 'helvetica' | 'times' | 'courier';

export interface AnnotStyle {
  readonly color: string;
  readonly width: number;
  readonly shape: ShapeKind;
  /** text tool font size in PDF points */
  readonly fontSize: number;
  /** text tool font family (core-14, no embedding needed) */
  readonly fontFamily: FontFamily;
  readonly bold: boolean;
  readonly italic: boolean;
  /** text tool border width in points; 0 = none */
  readonly textBorder: 0 | 1 | 2;
  /** text tool background fill; null = transparent */
  readonly textBg: string | null;
}

/** Compose the backend core-14 font token from family + style toggles. */
export function composeFontToken(family: FontFamily, bold: boolean, italic: boolean): string {
  const suffix = bold && italic ? '-bolditalic' : bold ? '-bold' : italic ? '-italic' : '';
  return family + suffix;
}

export interface EditorState {
  docId: string | null;
  pages: ReadonlyArray<EditorPage>;
  annots: ReadonlyArray<PendingAnnotation>;
  stamps: ReadonlyArray<PendingStamp>;
  fields: ReadonlyArray<PendingFormField>;
  past: ReadonlyArray<Snapshot>;
  future: ReadonlyArray<Snapshot>;

  /** non-null while the user is placing a new form field on the page */
  fieldDraft: FieldDraftType;

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
  updateAnnot(
    id: string,
    patch: Partial<Pick<PendingAnnotation, 'contents' | 'color' | 'rect' | 'paths' | 'line'>>,
  ): void;
  removeAnnot(id: string): void;

  addStamp(s: PendingStamp): void;
  removeStamp(id: string): void;

  setFieldDraft(t: FieldDraftType): void;
  addField(f: PendingFormField): void;
  updateField(id: string, patch: Partial<Pick<PendingFormField, 'name' | 'multiline'>>): void;
  removeField(id: string): void;

  undo(): void;
  redo(): void;
  clearPending(): void;
}

const HIGHLIGHT_DEFAULT = '#fde047';
const FONT_SIZE_DEFAULT = 14;

export const useEditorStore = create<EditorState>((set, get) => {
  /** push current pending state onto history and apply the next one */
  function commit(
    next: Partial<Pick<EditorState, 'pages' | 'annots' | 'stamps' | 'fields'>>,
  ) {
    const s = get();
    set({
      pages: next.pages ?? s.pages,
      annots: next.annots ?? s.annots,
      stamps: next.stamps ?? s.stamps,
      fields: next.fields ?? s.fields,
      past: [...s.past, { pages: s.pages, annots: s.annots, stamps: s.stamps, fields: s.fields }],
      future: [],
    });
  }

  return {
    docId: null,
    pages: [],
    annots: [],
    stamps: [],
    fields: [],
    past: [],
    future: [],
    fieldDraft: null,
    tool: 'select',
    zoom: 100,
    activePageId: null,
    annotStyle: {
      color: HIGHLIGHT_DEFAULT,
      width: 4,
      shape: 'square',
      fontSize: FONT_SIZE_DEFAULT,
      fontFamily: 'helvetica',
      bold: false,
      italic: false,
      textBorder: 0,
      textBg: null,
    },

    init(docId, pageCount) {
      const pages = initPages(pageCount);
      set({
        docId,
        pages,
        annots: [],
        stamps: [],
        fields: [],
        past: [],
        future: [],
        fieldDraft: null,
        tool: 'select',
        activePageId: pages[0]?.id ?? null,
      });
    },

    setTool: (tool) =>
      set((s) => ({ tool, fieldDraft: tool === 'forms' ? s.fieldDraft : null })),
    setZoom: (zoom) => set({ zoom }),
    setActivePage: (id) => set({ activePageId: id }),
    setAnnotStyle: (patch) => set((s) => ({ annotStyle: { ...s.annotStyle, ...patch } })),

    rotate(id, delta) {
      commit({ pages: rotatePage(get().pages, id, delta) });
    },
    remove(id) {
      const s = get();
      const pages = deletePage(s.pages, id);
      commit({ pages });
      if (s.activePageId === id) {
        const next = pages.find((p) => !p.deleted);
        if (next) set({ activePageId: next.id });
      }
    },
    restore(id) {
      commit({ pages: restorePage(get().pages, id) });
    },
    reorder(from, to) {
      commit({ pages: reorderPages(get().pages, from, to) });
    },

    addAnnot(a) {
      commit({ annots: [...get().annots, a] });
    },
    updateAnnot(id, patch) {
      commit({
        annots: get().annots.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      });
    },
    removeAnnot(id) {
      commit({ annots: get().annots.filter((a) => a.id !== id) });
    },

    addStamp(s) {
      commit({ stamps: [...get().stamps, s] });
    },
    removeStamp(id) {
      commit({ stamps: get().stamps.filter((s) => s.id !== id) });
    },

    setFieldDraft: (t) => set({ fieldDraft: t }),
    addField(f) {
      commit({ fields: [...get().fields, f] });
    },
    updateField(id, patch) {
      commit({
        fields: get().fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      });
    },
    removeField(id) {
      commit({ fields: get().fields.filter((f) => f.id !== id) });
    },

    undo() {
      const s = get();
      if (s.past.length === 0) return;
      const prev = s.past[s.past.length - 1];
      set({
        pages: prev.pages,
        annots: prev.annots,
        stamps: prev.stamps,
        fields: prev.fields,
        past: s.past.slice(0, -1),
        future: [...s.future, { pages: s.pages, annots: s.annots, stamps: s.stamps, fields: s.fields }],
      });
    },
    redo() {
      const s = get();
      if (s.future.length === 0) return;
      const next = s.future[s.future.length - 1];
      set({
        pages: next.pages,
        annots: next.annots,
        stamps: next.stamps,
        fields: next.fields,
        future: s.future.slice(0, -1),
        past: [...s.past, { pages: s.pages, annots: s.annots, stamps: s.stamps, fields: s.fields }],
      });
    },
    clearPending() {
      set({ annots: [], stamps: [], fields: [], fieldDraft: null, past: [], future: [] });
    },
  };
});
