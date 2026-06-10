/** Screen 2 orchestrator: meta + PDF loading, pending-ops save, versions,
 * document actions, keyboard shortcuts. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addAnnotations,
  applyPageOps,
  deleteDocument,
  downloadToDisk,
  duplicateDocument,
  getMeta,
  headPdfUrl,
  renameDocument,
  replaceContent,
  restoreVersion,
  splitDocument,
  stampSignature,
  versionPdfUrl,
} from '../api/documents';
import { usePdfDocument } from '../pdf/hooks';
import { useEditorStore } from '../state/editorStore';
import type { Tool } from '../state/editorStore';
import {
  buildPageOps,
  countPendingOps,
  initPages,
  toAnnotationInputs,
} from '../state/opsQueue';
import {
  dataUrlToBlob,
  placementRect,
  strokesToViewportPaths,
  SIGN_DEFAULT_W,
} from '../utils/signature';
import type { SignaturePayload } from '../utils/signature';
import {
  viewportPathToPdf,
  viewportRectToPdf,
  viewportSize,
} from '../pdf/coords';
import type { ViewportParams } from '../pdf/coords';
import { EditorToolbar } from '../components/Toolbar/EditorToolbar';
import { PageSidebar } from '../components/PageSidebar/PageSidebar';
import { Viewer } from '../components/Viewer/Viewer';
import type { SearchState } from '../components/Viewer/Viewer';
import { SignatureModal } from '../components/Viewer/SignatureModal';
import { DRAW_COLORS, HIGHLIGHT_COLORS } from '../components/Viewer/annotColors';
import { VersionPanel } from '../components/VersionPanel/VersionPanel';
import type { PanelTab } from '../components/VersionPanel/VersionPanel';
import { Modal } from '../components/shared/Modal';
import { SplitModal } from '../components/Split/SplitModal';
import { useToast } from '../components/shared/toastContext';
import type { SplitRange } from '../types/document';

const annUid = () => 'an_' + Math.random().toString(36).slice(2, 9);

/** Where a sign-tool click landed, pending the signature modal. */
interface SigningTarget {
  page: number;
  /** viewport px on that page */
  at: [number, number];
  vp: ViewportParams;
}

interface Props {
  docId: string;
  navigate: (id: string | null) => void;
}

export function EditorScreen({ docId, navigate }: Props) {
  const push = useToast();
  const qc = useQueryClient();
  const store = useEditorStore();

  const [viewing, setViewing] = useState<number | null>(null);
  const [panel, setPanel] = useState<{ tab: PanelTab; collapsed: boolean }>({
    tab: 'info',
    collapsed: false,
  });
  const [search, setSearch] = useState<SearchState>({ open: false, q: '', active: 0 });
  const [jumpToken, setJumpToken] = useState<{ id: string; t: number } | null>(null);
  const [docModal, setDocModal] = useState<'rename' | 'delete' | 'split' | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState<SigningTarget | null>(null);

  const metaQuery = useQuery({
    queryKey: ['meta', docId],
    queryFn: () => getMeta(docId),
    retry: 1,
  });
  const meta = metaQuery.data ?? null;
  const headVersion = meta?.document.headVersion ?? null;

  const headUrl = meta && headVersion != null ? headPdfUrl(docId, headVersion) : null;
  const head = usePdfDocument(headUrl);
  const viewUrl = viewing != null ? versionPdfUrl(docId, viewing) : null;
  const view = usePdfDocument(viewUrl);

  // (Re)initialize pending state when a (new) head PDF arrives.
  useEffect(() => {
    if (head.pdf) store.init(docId, head.pdf.pageCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, head.pdf]);

  // Document not found → back to library.
  useEffect(() => {
    if (metaQuery.isError) navigate(null);
  }, [metaQuery.isError, navigate]);

  const invalidateDoc = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['meta', docId] });
    void qc.invalidateQueries({ queryKey: ['documents'] });
    void qc.invalidateQueries({ queryKey: ['form', docId] });
  }, [qc, docId]);

  const pendingCount = countPendingOps(store.pages, store.annots, store.stamps);
  const dirty = pendingCount > 0;

  const save = useCallback(async () => {
    if (!dirty || viewing != null || saving) return;
    setSaving(true);
    try {
      const annPayload = toAnnotationInputs(store.annots);
      const pageOps = buildPageOps(store.pages);
      let lastVersion: number | null = null;
      if (annPayload.length > 0) {
        const doc = await addAnnotations(docId, annPayload);
        lastVersion = doc.headVersion;
      }
      // Stamps go after annotations and before page ops: neither annotations
      // nor stamps renumber pages, so head-version page numbers stay valid.
      for (const s of store.stamps) {
        const doc = await stampSignature(docId, s.page, s.rect, dataUrlToBlob(s.dataUrl));
        lastVersion = doc.headVersion;
      }
      if (pageOps.length > 0) {
        const doc = await applyPageOps(docId, pageOps);
        lastVersion = doc.headVersion;
      }
      store.clearPending();
      invalidateDoc();
      push({ type: 'success', title: lastVersion != null ? `Saved as v${lastVersion}` : 'Saved' });
    } catch {
      // API client already raised an error toast; pending state is preserved.
    } finally {
      setSaving(false);
    }
  }, [dirty, viewing, saving, store, docId, invalidateDoc, push]);

  /* ---- in-place text edit (mupdf engine) ---- */
  const onContentEdited = useCallback(
    async (bytes: Uint8Array) => {
      // On failure the API client raises the error toast and the rejection
      // propagates to the edit overlay, which stays open for retry.
      const doc = await replaceContent(docId, bytes);
      invalidateDoc();
      push({ type: 'success', title: `Text edit saved as v${doc.headVersion}` });
    },
    [docId, invalidateDoc, push],
  );

  /* ---- sign tool ---- */
  const applySignature = useCallback(
    (sig: SignaturePayload) => {
      if (!signing) return;
      const { at, vp, page } = signing;
      // Place in viewport space so the signature stays visually upright on
      // rotated pages, then convert to PDF points like all other annotations.
      const rectVp = placementRect(at, viewportSize(vp), sig.aspect, SIGN_DEFAULT_W * vp.scale);
      const rect = viewportRectToPdf(rectVp, vp);
      if (sig.kind === 'draw') {
        store.addAnnot({
          id: annUid(),
          type: 'ink',
          page,
          rect,
          color: sig.color,
          paths: strokesToViewportPaths(sig.strokes, rectVp).map((pts) =>
            viewportPathToPdf(pts, vp),
          ),
        });
      } else {
        store.addStamp({ id: annUid(), page, rect, dataUrl: sig.dataUrl });
      }
      setSigning(null);
    },
    [signing, store],
  );

  /** Tool switch with sensible per-tool palette defaults (from the design). */
  const pickTool = useCallback(
    (t: Tool) => {
      store.setTool(t);
      if (t === 'forms') setPanel((p) => ({ ...p, collapsed: false, tab: 'forms' }));
      const { color } = store.annotStyle;
      if (t === 'highlight' && !HIGHLIGHT_COLORS.includes(color)) {
        store.setAnnotStyle({ color: HIGHLIGHT_COLORS[0] });
      }
      if (['draw', 'shapes', 'text'].includes(t) && !DRAW_COLORS.includes(color)) {
        store.setAnnotStyle({ color: t === 'text' ? '#111827' : '#2563eb' });
      }
    },
    [store],
  );

  /* ---- versions ---- */
  const restoreMut = useMutation({
    mutationFn: (n: number) => restoreVersion(docId, n),
    onSuccess: (doc, n) => {
      setViewing(null);
      invalidateDoc();
      push({
        type: 'success',
        title: `Restored v${n} as v${doc.headVersion}`,
        msg: 'Previous version kept in history.',
      });
    },
  });

  function viewVersion(n: number) {
    setViewing(n);
    push({ type: 'success', title: `Viewing v${n}`, msg: 'Read-only — your unsaved changes are preserved.' });
  }

  /* ---- document actions ---- */
  const renameMut = useMutation({
    mutationFn: (name: string) => renameDocument(docId, name),
    onSuccess: (doc) => {
      invalidateDoc();
      push({ type: 'success', title: 'Renamed', msg: doc.name });
      setDocModal(null);
    },
  });
  const splitMut = useMutation({
    mutationFn: (ranges: SplitRange[]) => splitDocument(docId, ranges),
    onSuccess: (docs) => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      push({
        type: 'success',
        title: `Split into ${docs.length} ${docs.length === 1 ? 'document' : 'documents'}`,
        msg: docs.map((d) => d.name).join(', '),
        duration: 6000,
      });
      setDocModal(null);
      navigate(null); // back to the library, where the new documents are listed
    },
  });
  const deleteMut = useMutation({
    mutationFn: () => deleteDocument(docId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      push({ type: 'success', title: 'Document deleted', msg: meta?.document.name });
      navigate(null);
    },
  });

  function duplicateDoc() {
    if (!meta) return;
    void duplicateDocument(meta.document).then((copy) => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      push({ type: 'success', title: 'Duplicated', msg: copy.name });
    });
  }
  function downloadDoc() {
    if (!meta) return;
    void downloadToDisk(meta.document).then(() =>
      push({ type: 'success', title: 'Download started', msg: meta.document.name }),
    );
  }

  /* ---- page navigation ---- */
  const effPdf = viewing != null ? view.pdf : head.pdf;
  const effPages = useMemo(
    () => (viewing != null ? (view.pdf ? initPages(view.pdf.pageCount) : []) : store.pages),
    [viewing, view.pdf, store.pages],
  );
  const visiblePages = effPages.filter((p) => !p.deleted);

  const jump = useCallback(
    (id: string) => {
      store.setActivePage(id);
      setJumpToken({ id, t: Date.now() });
    },
    [store],
  );

  const navPage = useCallback(
    (dir: number) => {
      const idx = visiblePages.findIndex((p) => p.id === store.activePageId);
      const ni = Math.max(0, Math.min(visiblePages.length - 1, idx + dir));
      const target = visiblePages[ni];
      if (target) jump(target.id);
    },
    [visiblePages, store.activePageId, jump],
  );

  /* ---- keyboard ---- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearch((s) => ({ ...s, open: true }));
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (typing) return;
      const num = typeof store.zoom === 'number' ? store.zoom : 100;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        store.setZoom(Math.min(200, num + 25));
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        store.setZoom(Math.max(50, num - 25));
      }
      if (e.key === 'PageDown') {
        e.preventDefault();
        navPage(1);
      }
      if (e.key === 'PageUp') {
        e.preventDefault();
        navPage(-1);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [save, store, navPage]);

  const zoomLabel =
    typeof store.zoom === 'number'
      ? `${store.zoom}%`
      : store.zoom === 'fit-width'
        ? 'Fit W'
        : 'Fit P';

  if (!meta || !head.pdf) {
    return (
      <div className="app">
        <div className="toolbar">
          <div className="tb-left">
            <div className="skel" style={{ width: 32, height: 32, borderRadius: 6 }}></div>
            <div className="skel" style={{ width: 180, height: 14, marginLeft: 6 }}></div>
          </div>
          <div className="tb-center">
            <div className="skel" style={{ width: 200, height: 28 }}></div>
          </div>
          <div className="tb-right">
            <div className="skel" style={{ width: 120, height: 28 }}></div>
            <div className="skel" style={{ width: 80, height: 32, marginLeft: 8 }}></div>
          </div>
        </div>
        <div className="ed-body">
          <PageSidebar loading />
          <div className="viewer-wrap">
            <div className="viewer" style={{ display: 'grid', placeItems: 'center' }}>
              <div className="skel" style={{ width: 520, height: 680 }}></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const readonly = viewing != null;

  return (
    <div className="app">
      <EditorToolbar
        name={meta.document.name}
        tool={store.tool}
        setTool={pickTool}
        dirty={dirty}
        hasForm={meta.pdf.hasForm}
        zoom={store.zoom}
        zoomLabel={zoomLabel}
        setZoom={store.setZoom}
        canUndo={store.past.length > 0}
        canRedo={store.future.length > 0}
        undo={store.undo}
        redo={store.redo}
        pendingCount={pendingCount}
        saving={saving}
        onSave={() => void save()}
        onBack={() => navigate(null)}
        onToggleSearch={() =>
          setSearch((s) => (s.open ? { open: false, q: '', active: 0 } : { open: true, q: '', active: 0 }))
        }
        viewing={viewing}
        onRename={() => {
          setRenameVal(meta.document.name);
          setDocModal('rename');
        }}
        onDuplicate={duplicateDoc}
        onSplit={() => setDocModal('split')}
        onDownload={downloadDoc}
        onDelete={() => setDocModal('delete')}
      />
      <div className="ed-body">
        <PageSidebar
          pdf={effPdf}
          pages={effPages}
          activeId={store.activePageId}
          onJump={jump}
          onRotate={store.rotate}
          onDelete={store.remove}
          onRestore={store.restore}
          onReorder={store.reorder}
          readonly={readonly}
        />
        {effPdf ? (
          <Viewer
            pdf={effPdf}
            pages={effPages}
            activeId={store.activePageId}
            zoom={store.zoom}
            jumpToken={jumpToken}
            onActivePage={store.setActivePage}
            search={search}
            setSearch={setSearch}
            viewing={viewing}
            onExitVersion={() => setViewing(null)}
            tool={store.tool}
            annotStyle={store.annotStyle}
            setAnnotStyle={store.setAnnotStyle}
            annots={readonly ? [] : store.annots}
            stamps={readonly ? [] : store.stamps}
            onAddAnnot={store.addAnnot}
            onUpdateAnnot={(id, patch) => store.updateAnnot(id, patch)}
            onRemoveAnnot={store.removeAnnot}
            onRemoveStamp={store.removeStamp}
            onSign={(page, at, vp) => setSigning({ page, at, vp })}
            onContentEdited={onContentEdited}
          />
        ) : (
          <div className="viewer-wrap">
            <div className="viewer" style={{ display: 'grid', placeItems: 'center' }}>
              <div className="skel" style={{ width: 520, height: 680 }}></div>
            </div>
          </div>
        )}
        <VersionPanel
          meta={meta}
          visiblePages={visiblePages.length}
          collapsed={panel.collapsed}
          setCollapsed={(c) => setPanel((p) => ({ ...p, collapsed: c }))}
          tab={panel.tab}
          setTab={(t) => setPanel((p) => ({ ...p, tab: t }))}
          viewing={viewing}
          onView={viewVersion}
          onRestore={(n) => restoreMut.mutate(n)}
        />
      </div>
      {signing && (
        <SignatureModal onApply={applySignature} onCancel={() => setSigning(null)} />
      )}
      {docModal === 'rename' && (
        <Modal
          title="Rename document"
          confirmLabel="Save"
          onConfirm={() => {
            if (renameVal.trim()) renameMut.mutate(renameVal.trim());
          }}
          onCancel={() => setDocModal(null)}
        >
          <input
            className="rename-input"
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameVal.trim()) renameMut.mutate(renameVal.trim());
            }}
          />
        </Modal>
      )}
      {docModal === 'split' && (
        <SplitModal
          pageCount={meta.pdf.pageCount}
          busy={splitMut.isPending}
          onSplit={(ranges) => splitMut.mutate(ranges)}
          onCancel={() => setDocModal(null)}
        />
      )}
      {docModal === 'delete' && (
        <Modal
          title="Delete document?"
          confirmLabel="Delete"
          danger
          onConfirm={() => deleteMut.mutate()}
          onCancel={() => setDocModal(null)}
        >
          “{meta.document.name}” and its entire version history will be permanently removed. You’ll
          be returned to your documents. This can’t be undone.
        </Modal>
      )}
    </div>
  );
}
