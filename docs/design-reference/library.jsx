/* library.jsx — Screen 1: Document Library (quick actions + multi-file upload queue) */
const { useState: _uS, useRef: _uR, useEffect: _uE } = React;
const lid = () => Math.random().toString(36).slice(2, 9);

function MiniSheet({ doc }) {
  return (
    <div className="sheet-mini">
      <div style={{ height: '100%' }}>
        <ThumbContent page={doc.pages.find(p => !p.deleted) || doc.pages[0]} />
      </div>
    </div>
  );
}

/* shared kebab item set for a document */
function docMenu(doc, a) {
  return [
    { label: 'Open', icon: 'fileText', onClick: () => a.onOpen(doc.id) },
    { label: 'Rename', icon: 'pen', onClick: () => a.onRename(doc) },
    { label: 'Duplicate', icon: 'copy', onClick: () => a.onDuplicate(doc) },
    { sep: true },
    { label: 'Download', icon: 'download', onClick: () => a.onDownload(doc) },
    { sep: true },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => a.onDelete(doc) },
  ];
}

function DocCard({ doc, actions }) {
  const visiblePages = doc.pages.filter(p => !p.deleted).length;
  return (
    <div className="doc-card" onClick={() => actions.onOpen(doc.id)}>
      <div className="dc-thumb">
        <MiniSheet doc={doc} />
        <div className="dc-badges">
          {doc.encrypted && <span className="badge amber"><Icon name="lock" size={12} />Encrypted</span>}
        </div>
        <span className="dc-pagecount">{visiblePages} {visiblePages === 1 ? 'page' : 'pages'}</span>
      </div>
      <div className="dc-meta">
        <div className="dc-name"><span className="nm" title={doc.name}>{truncMid(doc.name, 28)}</span></div>
        <div className="dc-sub">
          {doc.hasForms && <span className="badge" style={{ height: 18, fontSize: 10.5 }}>Form</span>}
          <span>{fmtSize(doc.sizeKB)}</span>
        </div>
        <div className="dc-foot">
          <span className="dc-ver"><span className="vtag">v{doc.version}</span> · {relTime(doc.updated)}</span>
          <div className="kebab-host" onClick={(e) => e.stopPropagation()}>
            <Kebab items={docMenu(doc, actions)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DocRow({ doc, actions }) {
  const visiblePages = doc.pages.filter(p => !p.deleted).length;
  return (
    <div className="doc-row" onClick={() => actions.onOpen(doc.id)}>
      <div className="dr-thumb"><ThumbContent page={doc.pages.find(p => !p.deleted) || doc.pages[0]} /></div>
      <div className="dr-main">
        <div className="dr-name">
          <span className="nm" title={doc.name}>{truncMid(doc.name, 44)}</span>
          {doc.hasForms && <span className="badge" style={{ height: 18, fontSize: 10.5 }}>Form</span>}
          {doc.encrypted && <span className="badge amber" style={{ height: 18, fontSize: 10.5 }}><Icon name="lock" size={11} />Encrypted</span>}
        </div>
      </div>
      <div className="dr-col tnum">{visiblePages} {visiblePages === 1 ? 'page' : 'pages'}</div>
      <div className="dr-col tnum">{fmtSize(doc.sizeKB)}</div>
      <div className="dr-col"><span className="dc-ver"><span className="vtag">v{doc.version}</span> · {relTime(doc.updated)}</span></div>
      <div className="dr-kebab" onClick={(e) => e.stopPropagation()}>
        <Kebab items={docMenu(doc, actions)} />
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="card-skel">
      <div className="cs-thumb skel"></div>
      <div className="cs-meta">
        <div className="skel" style={{ height: 13, width: '80%' }}></div>
        <div className="skel" style={{ height: 11, width: '50%' }}></div>
        <div className="skel" style={{ height: 11, width: '64%', marginTop: 6 }}></div>
      </div>
    </div>
  );
}

function RenameModal({ doc, onSave, onCancel }) {
  const [name, setName] = _uS(doc.name);
  const ref = _uR(null);
  _uE(() => { if (ref.current) { ref.current.focus(); ref.current.select(); } }, []);
  return (
    <Modal title="Rename document" confirmLabel="Save" onConfirm={() => name.trim() && onSave(name.trim())} onCancel={onCancel}>
      <input ref={ref} className="rename-input" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); }} />
    </Modal>
  );
}

function Dropzone({ onFiles }) {
  const [over, setOver] = _uS(false);
  const inputRef = _uR(null);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
      role="button" tabIndex={0}
    >
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden
        onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      <div className="dz-icon"><Icon name="upload" size={24} /></div>
      <div className="dz-title">Drop PDFs here or <span className="lnk">click to browse</span></div>
      <div className="dz-sub">PDF only · up to 50 MB · multiple files supported</div>
    </div>
  );
}

function UploadCard({ task, onCancel }) {
  if (task.status === 'error') {
    return (
      <div className="up-card error">
        <span className="up-ico"><Icon name="alert" size={18} /></span>
        <div className="up-body">
          <div className="up-name">{task.name}</div>
          <div className="up-msg">{task.error}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="up-card">
      <span className="up-ico"><Icon name="fileText" size={18} /></span>
      <div className="up-body">
        <div className="up-top">
          <span className="up-name">{task.name}</span>
          <span className="up-pct tnum">{task.pct}%</span>
        </div>
        <div className="up-bar"><i style={{ width: `${task.pct}%` }}></i></div>
      </div>
      <button className="iconbtn up-x" onClick={() => onCancel(task.id)} aria-label="Cancel"><Icon name="close" size={15} /></button>
    </div>
  );
}

function Library({ docs, setDocs, navigate, loading, libView }) {
  const push = useToast();
  const [confirmDel, setConfirmDel] = _uS(null);
  const [renaming, setRenaming] = _uS(null);
  const [uploads, setUploads] = _uS([]);
  const intervals = _uR({});

  _uE(() => () => { Object.values(intervals.current).forEach(clearInterval); }, []);

  function makeDoc({ name, sizeKB }) {
    const np = Math.max(1, Math.round(sizeKB / 90));
    const kinds = ['cover', 'prose', 'table', 'prose', 'placeholder'];
    const pages = Array.from({ length: Math.min(np, 12) || 1 }).map((_, i) => ({
      id: `up_${Date.now()}_${i}_${lid()}`, n: i + 1, kind: i === 0 ? 'cover' : kinds[i % kinds.length], rot: 0, deleted: false,
    }));
    const now = Date.now();
    return { id: 'up_' + now + '_' + lid(), name, sizeKB, created: now, updated: now, version: 1, hasForms: false, encrypted: false, pages, annots: {}, versions: [{ v: 1, ts: now, summary: 'initial upload', sizeKB }] };
  }

  function startUpload(f) {
    const id = lid();
    const kb = Math.max(40, Math.round(f.size / 1024)) || 280;
    setUploads(u => [...u, { id, name: f.name, pct: 0, status: 'uploading' }]);
    let pct = 0;
    intervals.current[id] = setInterval(() => {
      pct = Math.min(100, pct + Math.random() * 16 + 6);
      setUploads(u => u.map(t => t.id === id ? { ...t, pct: Math.round(pct) } : t));
      if (pct >= 100) {
        clearInterval(intervals.current[id]); delete intervals.current[id];
        setTimeout(() => {
          setUploads(u => u.filter(t => t.id !== id));
          setDocs(d => [makeDoc({ name: f.name, sizeKB: kb }), ...d]);
          push({ type: 'success', title: 'Upload complete', msg: f.name });
        }, 300);
      }
    }, 260);
  }

  function addError(name, error) {
    const id = lid();
    setUploads(u => [...u, { id, name, status: 'error', error }]);
    setTimeout(() => setUploads(u => u.filter(t => t.id !== id)), 4000);
  }

  function onFiles(files) {
    [...files].forEach(f => {
      const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
      if (!isPdf) return addError(f.name, 'Not a PDF — only .pdf files are supported.');
      if (f.size > 50 * 1024 * 1024) return addError(f.name, 'Too large — 50 MB maximum.');
      startUpload(f);
    });
  }

  function cancelUpload(id) {
    if (intervals.current[id]) { clearInterval(intervals.current[id]); delete intervals.current[id]; }
    setUploads(u => u.filter(t => t.id !== id));
    push({ type: 'error', title: 'Upload canceled' });
  }

  const actions = {
    onOpen: navigate,
    onRename: (doc) => setRenaming(doc),
    onDuplicate: (doc) => {
      const now = Date.now();
      const copy = { ...JSON.parse(JSON.stringify(doc)), id: 'dup_' + now + '_' + lid(), name: doc.name.replace(/(\.pdf)?$/i, m => ' (copy)' + (m || '')), updated: now, created: now };
      setDocs(d => { const i = d.findIndex(x => x.id === doc.id); const nd = [...d]; nd.splice(i + 1, 0, copy); return nd; });
      push({ type: 'success', title: 'Duplicated', msg: copy.name });
    },
    onDownload: (doc) => push({ type: 'success', title: 'Download started', msg: doc.name }),
    onDelete: (doc) => setConfirmDel(doc),
  };

  function doRename(name) {
    setDocs(list => list.map(x => x.id === renaming.id ? { ...x, name, updated: Date.now() } : x));
    push({ type: 'success', title: 'Renamed', msg: name });
    setRenaming(null);
  }
  function doDelete() {
    const d = confirmDel; setConfirmDel(null);
    setDocs(list => list.filter(x => x.id !== d.id));
    push({ type: 'success', title: 'Document deleted', msg: d.name });
  }

  return (
    <div className="lib">
      <div className="lib-top">
        <div className="brand"><span className="logo"><Icon name="file" size={16} /></span>PDFEditor</div>
        <ThemeToggle />
      </div>
      <div className="lib-scroll scroll">
        <div className="lib-inner">
          <Dropzone onFiles={onFiles} />

          {uploads.length > 0 && (
            <div className="upload-list">
              <div className="lib-sec" style={{ margin: '24px 0 12px' }}>
                <h2>Uploading</h2>
                <span className="cnt">{uploads.filter(u => u.status === 'uploading').length} in progress</span>
              </div>
              <div className="up-stack">
                {uploads.map(t => <UploadCard key={t.id} task={t} onCancel={cancelUpload} />)}
              </div>
            </div>
          )}

          <div className="lib-sec">
            <h2>Your documents</h2>
            <span className="cnt">{loading ? '' : `${docs.length} ${docs.length === 1 ? 'file' : 'files'}`}</span>
          </div>

          {loading ? (
            libView === 'list'
              ? <div className="doc-list">{Array.from({ length: 5 }).map((_, i) => <div className="row-skel" key={i}><div className="skel" style={{ width: 40, height: 52, borderRadius: 4 }}></div><div className="skel" style={{ height: 13, width: '40%' }}></div></div>)}</div>
              : <div className="doc-grid">{Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}</div>
          ) : docs.length === 0 ? (
            <div className="empty">
              <div className="e-icon"><Icon name="fileText" size={26} /></div>
              <h3>No documents yet</h3>
              <p>Upload your first PDF to get started.</p>
            </div>
          ) : libView === 'list' ? (
            <div className="doc-list">
              <div className="doc-list-head">
                <span style={{ gridColumn: '1 / 3' }}>Name</span><span>Pages</span><span>Size</span><span>Version</span><span></span>
              </div>
              {docs.map(d => <DocRow key={d.id} doc={d} actions={actions} />)}
            </div>
          ) : (
            <div className="doc-grid">
              {docs.map(d => <DocCard key={d.id} doc={d} actions={actions} />)}
            </div>
          )}
        </div>
      </div>

      {renaming && <RenameModal doc={renaming} onSave={doRename} onCancel={() => setRenaming(null)} />}
      {confirmDel && (
        <Modal title="Delete document?" confirmLabel="Delete" danger onConfirm={doDelete} onCancel={() => setConfirmDel(null)}>
          “{confirmDel.name}” and its version history will be permanently removed. This can’t be undone.
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { Library });
