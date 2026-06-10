/* editor.jsx — Screen 2 orchestrator: state, ops queue, undo/redo, save, shortcuts */

const clone = (x) => JSON.parse(JSON.stringify(x));

function Editor({ docId, navigate, onDocUpdated, setDocs, toolLabels }) {
  const push = useToast();
  const [loading, setLoading] = React.useState(true);
  const [doc, setDoc] = React.useState(null);
  const [docModal, setDocModal] = React.useState(null); // 'rename' | 'delete'
  const [renameVal, setRenameVal] = React.useState('');
  const [pages, setPages] = React.useState([]);
  const [ops, setOps] = React.useState([]);
  const histRef = React.useRef({ past: [], future: [] });
  const [, forceHist] = React.useState(0);
  const bump = () => forceHist(n => n + 1);

  const [tool, setTool] = React.useState('select');
  const [annots, setAnnots] = React.useState({});
  const [annotStyle, setAnnotStyle] = React.useState({ color: '#fde047', width: 4, size: 18, shape: 'rect' });
  const [signing, setSigning] = React.useState(null);
  const [zoom, setZoomState] = React.useState(100);
  const [activeId, setActiveId] = React.useState(null);
  const [jumpToken, setJumpToken] = React.useState(null);
  const [search, setSearch] = React.useState({ open: false, q: '', active: 0 });
  const [searchCount, setSearchCount] = React.useState(0);
  const [panel, setPanel] = React.useState({ tab: 'info', collapsed: false });
  const [viewing, setViewing] = React.useState(null);

  // load
  React.useEffect(() => {
    setLoading(true);
    const d = loadDoc(docId);
    const t = setTimeout(() => {
      if (!d) { navigate(null); return; }
      setDoc(d); setPages(clone(d.pages)); setOps([]); setAnnots(clone(d.annots || {}));
      histRef.current = { past: [], future: [] };
      setActiveId(d.pages.find(p => !p.deleted)?.id || d.pages[0]?.id);
      setLoading(false);
    }, 650);
    return () => clearTimeout(t);
  }, [docId]);

  /* ---- mutations w/ history ---- */
  function commit(newPages, newOps, newAnnots) {
    if (newAnnots === undefined) newAnnots = annots;
    histRef.current.past.push({ pages, ops, annots });
    histRef.current.future = [];
    setPages(newPages); setOps(newOps); setAnnots(newAnnots); bump();
  }
  function undo() {
    const h = histRef.current; if (!h.past.length) return;
    const prev = h.past.pop();
    h.future.push({ pages, ops, annots });
    setPages(prev.pages); setOps(prev.ops); setAnnots(prev.annots); bump();
  }
  function redo() {
    const h = histRef.current; if (!h.future.length) return;
    const next = h.future.pop();
    h.past.push({ pages, ops, annots });
    setPages(next.pages); setOps(next.ops); setAnnots(next.annots); bump();
  }

  /* ---- annotations ---- */
  function chooseTool(id) {
    setTool(id);
    setAnnotStyle(s => {
      if (id === 'highlight') return ANNOT_COLORS.includes(s.color) ? s : { ...s, color: ANNOT_COLORS[0] };
      if (['draw', 'shapes', 'text'].includes(id)) return DRAW_COLORS.includes(s.color) ? s : { ...s, color: id === 'text' ? '#111827' : '#2563eb' };
      return s;
    });
  }
  function requestSign(pageId, p) { setSigning({ pageId, x: p.x, y: p.y }); }
  function applySign(sig) {
    const { pageId, x, y } = signing;
    const w = 0.26, h = sig.mode === 'draw' ? 0.11 : 0.066;
    addAnnot(pageId, { id: auid(), type: 'sign', x: Math.max(0, Math.min(1 - w, x - w / 2)), y: Math.max(0, Math.min(1 - h, y - h / 2)), w, h, mode: sig.mode, text: sig.text, strokes: sig.strokes, color: sig.color });
    setSigning(null);
  }
  function setFormField(pageId, field, value) {
    const arr = annots[pageId] || [];
    const existing = arr.find(a => a.type === 'formfill' && a.field === field);
    if (existing) {
      if (!value) {
        setAnnots(prev => ({ ...prev, [pageId]: (prev[pageId] || []).filter(x => !(x.type === 'formfill' && x.field === field)) }));
        setOps(o => o.filter(op => !(op.type === 'annotate' && op.annId === existing.id))); bump();
      } else {
        setAnnots(prev => ({ ...prev, [pageId]: (prev[pageId] || []).map(x => (x.type === 'formfill' && x.field === field) ? { ...x, value } : x) })); bump();
      }
    } else if (value) {
      const id = auid();
      commit(pages, [...ops, { type: 'annotate', subtype: 'form', pageId, annId: id }], { ...annots, [pageId]: [...arr, { id, type: 'formfill', field, value, pending: true }] });
    }
  }
  function addAnnot(pageId, a) {
    const na = { ...annots, [pageId]: [...(annots[pageId] || []), { ...a, pending: true }] };
    commit(pages, [...ops, { type: 'annotate', subtype: a.type, pageId, annId: a.id }], na);
  }
  function updateAnnot(pageId, id, patch) {
    const na = { ...annots, [pageId]: (annots[pageId] || []).map(x => x.id === id ? { ...x, ...patch } : x) };
    commit(pages, ops, na);
  }
  function deleteAnnot(pageId, id) {
    const na = { ...annots, [pageId]: (annots[pageId] || []).filter(x => x.id !== id) };
    const no = ops.filter(o => !(o.type === 'annotate' && o.annId === id));
    commit(pages, no, na);
  }

  function rotate(pageId, delta) {
    const np = pages.map(p => p.id === pageId ? { ...p, rot: p.rot + delta } : p);
    let no = ops.slice();
    const li = no.length - 1;
    if (li >= 0 && no[li].type === 'rotate' && no[li].pageId === pageId) {
      const deg = no[li].deg + delta;
      if (((deg % 360) + 360) % 360 === 0) no = no.slice(0, li);
      else no = [...no.slice(0, li), { ...no[li], deg }];
    } else {
      no = [...no, { type: 'rotate', pageId, deg: delta }];
    }
    commit(np, no);
  }
  function del(pageId) {
    const np = pages.map(p => p.id === pageId ? { ...p, deleted: true } : p);
    const no = ops.some(o => o.type === 'delete' && o.pageId === pageId) ? ops : [...ops, { type: 'delete', pageId }];
    commit(np, no);
    if (activeId === pageId) {
      const vis = np.filter(p => !p.deleted);
      if (vis.length) setActiveId(vis[0].id);
    }
  }
  function restore(pageId) {
    const np = pages.map(p => p.id === pageId ? { ...p, deleted: false } : p);
    const no = ops.filter(o => !(o.type === 'delete' && o.pageId === pageId));
    commit(np, no);
  }
  function reorder(from, to) {
    const np = pages.slice();
    const [m] = np.splice(from, 1);
    np.splice(to, 0, m);
    const no = ops.some(o => o.type === 'reorder' && o.pageId === m.id) ? ops : [...ops, { type: 'reorder', pageId: m.id }];
    commit(np, no);
  }

  /* ---- save ---- */
  function buildSummary() {
    const posOf = (id) => pages.findIndex(p => p.id === id) + 1;
    const uniq = (arr) => [...new Set(arr.map(o => posOf(o.pageId)))].sort((a, b) => a - b).map(p => 'p' + p).join(', ');
    const groups = {};
    ops.forEach(o => { (groups[o.type] = groups[o.type] || []).push(o); });
    const parts = [];
    if (groups.rotate) parts.push('rotate ' + uniq(groups.rotate));
    if (groups.delete) parts.push('delete ' + uniq(groups.delete));
    if (groups.reorder) parts.push('reorder ' + uniq(groups.reorder));
    if (groups.annotate) {
      const sub = {};
      groups.annotate.forEach(o => { (sub[o.subtype] = sub[o.subtype] || []).push(o); });
      ['highlight', 'comment', 'draw', 'text', 'shape', 'sign', 'form'].forEach(st => { if (sub[st]) parts.push(st + ' ' + uniq(sub[st])); });
    }
    return parts.join(' · ');
  }
  function save() {
    if (!ops.length || viewing != null) return;
    const summary = buildSummary();
    const kept = pages.filter(p => !p.deleted).map((p, i) => ({ ...p, n: i + 1 }));
    const keptIds = new Set(kept.map(p => p.id));
    const bakedAnnots = {};
    Object.keys(annots).forEach(pid => {
      if (!keptIds.has(pid)) return;
      const arr = (annots[pid] || []).map(a => ({ ...a, pending: false }));
      if (arr.length) bakedAnnots[pid] = arr;
    });
    const newV = doc.version + 1;
    const delta = (Math.random() * 80 - 30) | 0;
    const sizeKB = Math.max(40, doc.sizeKB + delta);
    const versions = [{ v: newV, ts: Date.now(), summary, sizeKB }, ...doc.versions];
    const nd = { ...doc, pages: kept, annots: bakedAnnots, version: newV, versions, updated: Date.now(), sizeKB };
    setDoc(nd); setPages(clone(kept)); setAnnots(clone(bakedAnnots)); setOps([]);
    histRef.current = { past: [], future: [] }; bump();
    if (!kept.some(p => p.id === activeId)) setActiveId(kept[0]?.id);
    onDocUpdated && onDocUpdated(nd);
    push({ type: 'success', title: `Saved as v${newV}`, msg: summary || 'No changes' });
  }

  /* ---- versions ---- */
  function viewVersion(v) { setViewing(v); push({ type: 'success', title: `Viewing v${v}`, msg: 'Read-only — your unsaved changes are preserved.' }); }
  function exitVersion() { setViewing(null); }
  function restoreVersion(v) {
    const newV = doc.version + 1;
    const src = doc.versions.find(x => x.v === v);
    const versions = [{ v: newV, ts: Date.now(), summary: `restore from v${v}`, sizeKB: src ? src.sizeKB : doc.sizeKB }, ...doc.versions];
    const nd = { ...doc, version: newV, versions, updated: Date.now() };
    setDoc(nd); setViewing(null);
    onDocUpdated && onDocUpdated(nd);
    push({ type: 'success', title: `Restored v${v} as v${newV}`, msg: 'Previous version kept in history.' });
  }

  function deleteVersion(v) {
    if (v === doc.version) return;
    const versions = doc.versions.filter(x => x.v !== v);
    const nd = { ...doc, versions };
    setDoc(nd); if (viewing === v) setViewing(null);
    onDocUpdated && onDocUpdated(nd);
    push({ type: 'success', title: `Deleted v${v}`, msg: 'Removed from version history.' });
  }

  /* ---- zoom ---- */
  function setZoom(v) { setZoomState(v); }
  const zoomLabel = typeof zoom === 'number' ? `${zoom}%` : (zoom === 'fit-width' ? 'Fit W' : 'Fit P');

  /* ---- page nav ---- */
  function jump(id) { setActiveId(id); setJumpToken({ id, t: Date.now() }); }
  function navPage(dir) {
    const vis = (viewing != null ? doc.pages : pages).filter(p => !p.deleted);
    const idx = vis.findIndex(p => p.id === activeId);
    const ni = Math.max(0, Math.min(vis.length - 1, idx + dir));
    if (vis[ni]) jump(vis[ni].id);
  }

  /* ---- search ---- */
  const openSearch = () => setSearch(s => ({ ...s, open: true }));
  const closeSearch = () => setSearch({ open: false, q: '', active: 0 });
  const toggleSearch = () => setSearch(s => s.open ? { open: false, q: '', active: 0 } : { open: true, q: '', active: 0 });
  const setSearchQ = (q) => setSearch(s => ({ ...s, q, active: 0 }));
  const setSearchActive = (a) => setSearch(s => ({ ...s, active: a }));
  React.useEffect(() => { if (search.active >= searchCount) setSearch(s => ({ ...s, active: 0 })); }, [searchCount]);

  /* ---- document-level actions ---- */
  function openRename() { setRenameVal(doc.name); setDocModal('rename'); }
  function doRename() {
    const name = renameVal.trim(); if (!name) return;
    const nd = { ...doc, name, updated: Date.now() };
    setDoc(nd); onDocUpdated && onDocUpdated(nd);
    push({ type: 'success', title: 'Renamed', msg: name }); setDocModal(null);
  }
  function duplicateDoc() {
    const now = Date.now();
    const copy = { ...clone(doc), id: 'dup_' + now, name: doc.name.replace(/(\.pdf)?$/i, m => ' (copy)' + (m || '')), created: now, updated: now };
    setDocs && setDocs(d => { const i = d.findIndex(x => x.id === doc.id); const nd = [...d]; if (i >= 0) nd.splice(i + 1, 0, copy); else nd.unshift(copy); return nd; });
    push({ type: 'success', title: 'Duplicated', msg: copy.name });
  }
  function downloadDoc() { push({ type: 'success', title: 'Download started', msg: doc.name }); }
  function deleteDocConfirmed() {
    setDocs && setDocs(d => d.filter(x => x.id !== doc.id));
    setDocModal(null);
    push({ type: 'success', title: 'Document deleted', msg: doc.name });
    navigate(null);
  }

  /* ---- keyboard ---- */
  React.useEffect(() => {
    function onKey(e) {
      const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (typing) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(Math.min(200, (typeof zoom === 'number' ? zoom : 100) + 25)); }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(Math.max(50, (typeof zoom === 'number' ? zoom : 100) - 25)); }
      if (e.key === 'PageDown') { e.preventDefault(); navPage(1); }
      if (e.key === 'PageUp') { e.preventDefault(); navPage(-1); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (loading || !doc) {
    return (
      <div className="app">
        <div className="toolbar">
          <div className="tb-left"><div className="skel" style={{ width: 32, height: 32, borderRadius: 6 }}></div><div className="skel" style={{ width: 180, height: 14, marginLeft: 6 }}></div></div>
          <div className="tb-center"><div className="skel" style={{ width: 200, height: 28 }}></div></div>
          <div className="tb-right"><div className="skel" style={{ width: 120, height: 28 }}></div><div className="skel" style={{ width: 80, height: 32, marginLeft: 8 }}></div></div>
        </div>
        <div className="ed-body">
          <PageSidebar loading />
          <div className="viewer-wrap"><div className="viewer" style={{ display: 'grid', placeItems: 'center' }}><div className="skel" style={{ width: 520, height: 680 }}></div></div></div>
        </div>
      </div>
    );
  }

  const effPages = viewing != null ? doc.pages : pages;
  const sidebarPages = effPages;
  const viewerPages = effPages.filter(p => !p.deleted);
  const headVersion = doc.version;

  return (
    <div className="app">
      <EditorToolbar
        doc={doc} tool={tool} setTool={chooseTool} dirty={ops.length > 0}
        zoom={zoom} zoomLabel={zoomLabel} setZoom={setZoom} fit={setZoom}
        canUndo={histRef.current.past.length > 0} canRedo={histRef.current.future.length > 0}
        undo={undo} redo={redo} pendingCount={ops.length} onSave={save}
        onBack={() => navigate(null)} onToggleSearch={toggleSearch} viewing={viewing} toolLabels={toolLabels}
        onRename={openRename} onDuplicate={duplicateDoc} onDownload={downloadDoc} onDelete={() => setDocModal('delete')}
      />
      <div className="ed-body">
        <PageSidebar
          pages={sidebarPages} activeId={activeId} onJump={jump}
          onRotate={rotate} onDelete={del} onRestore={restore} onReorder={reorder}
          readonly={viewing != null}
        />
        <Viewer
          pages={viewerPages} activeId={activeId} zoom={zoom} jumpToken={jumpToken}
          onActivePage={setActiveId}
          search={search} setSearchQ={setSearchQ} setSearchActive={setSearchActive}
          setSearchCount={setSearchCount} closeSearch={closeSearch}
          viewing={viewing} onExitVersion={exitVersion}
          tool={tool} annots={viewing != null ? (doc.annots || {}) : annots}
          annotStyle={annotStyle} setAnnotStyle={setAnnotStyle}
          onAddAnnot={addAnnot} onUpdateAnnot={updateAnnot} onDeleteAnnot={deleteAnnot}
          onRequestSign={requestSign} onFormFill={setFormField}
        />
        <VersionPanel
          doc={doc} collapsed={panel.collapsed} setCollapsed={(c) => setPanel(p => ({ ...p, collapsed: c }))}
          tab={panel.tab} setTab={(t) => setPanel(p => ({ ...p, tab: t }))}
          headVersion={headVersion} viewing={viewing} onView={viewVersion} onRestore={restoreVersion} onDelete={deleteVersion}
        />
      </div>
      {signing && <SignatureModal onApply={applySign} onCancel={() => setSigning(null)} />}
      {docModal === 'rename' && (
        <Modal title="Rename document" confirmLabel="Save" onConfirm={doRename} onCancel={() => setDocModal(null)}>
          <input className="rename-input" autoFocus value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doRename(); }} />
        </Modal>
      )}
      {docModal === 'delete' && (
        <Modal title="Delete document?" confirmLabel="Delete" danger onConfirm={deleteDocConfirmed} onCancel={() => setDocModal(null)}>
          “{doc.name}” and its entire version history will be permanently removed. You’ll be returned to your documents. This can’t be undone.
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { Editor });
