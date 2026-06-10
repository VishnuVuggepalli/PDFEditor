/* editor-panel.jsx — right panel: Info + Versions */

function InfoTab({ doc }) {
  const visible = doc.pages.filter(p => !p.deleted).length;
  const created = new Date(doc.created).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <div>
      <div className="info-row"><span className="k">Filename</span><span className="v">{doc.name}</span></div>
      <div className="info-row"><span className="k">Pages</span><span className="v tnum">{visible}</span></div>
      <div className="info-row"><span className="k">File size</span><span className="v tnum">{fmtSize(doc.sizeKB)}</span></div>
      <div className="info-row"><span className="k">Version</span><span className="v">v{doc.version}</span></div>
      <div className="info-row"><span className="k">Created</span><span className="v">{created}</span></div>
      <div className="info-badges">
        {doc.hasForms && <span className="badge accent"><Icon name="forms" size={12} />Form fields</span>}
        {doc.encrypted && <span className="badge amber"><Icon name="lock" size={12} />Encrypted</span>}
        {!doc.hasForms && !doc.encrypted && <span className="badge">No special attributes</span>}
      </div>
    </div>
  );
}

function VersionsTab({ doc, headVersion, viewing, onView, onRestore, onDelete }) {
  const [confirm, setConfirm] = React.useState(null); // {v, action}
  return (
    <div className="vtl">
      {doc.versions.map(v => {
        const isHead = v.v === headVersion;
        return (
          <div key={v.v} className={`vrow ${isHead ? 'head' : ''} ${viewing === v.v ? 'viewing' : ''}`}>
            <span className="vdot"></span>
            <div className="vcard">
              <div className="v-top">
                <span className="v-name">v{v.v}</span>
                {isHead && <span className="badge current" style={{ height: 18, fontSize: 10.5, padding: '0 7px' }}>current</span>}
                {viewing === v.v && <span className="badge amber" style={{ height: 18, fontSize: 10.5 }}>viewing</span>}
                <span className="v-time">{relTime(v.ts)}</span>
              </div>
              <div className="v-sum">{v.summary}</div>
              <div className="v-size">{fmtSize(v.sizeKB)}</div>
              {!isHead && (
                <div className="v-acts">
                  <button onClick={() => onView(v.v)}><Icon name="eye" />View</button>
                  <button onClick={() => setConfirm({ v: v.v, action: 'restore' })}><Icon name="restore" />Restore</button>
                  <button className="v-del" onClick={() => setConfirm({ v: v.v, action: 'delete' })} aria-label="Delete version"><Icon name="trash" /></button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {confirm && confirm.action === 'restore' && (
        <Modal title={`Restore v${confirm.v}?`} confirmLabel="Restore" cancelLabel="Cancel"
          onConfirm={() => { const v = confirm.v; setConfirm(null); onRestore(v); }}
          onCancel={() => setConfirm(null)}>
          This creates a new version from the contents of <strong style={{ color: 'var(--text)' }}>v{confirm.v}</strong>. Your current version is kept in history — nothing is lost.
        </Modal>
      )}
      {confirm && confirm.action === 'delete' && (
        <Modal title={`Delete v${confirm.v}?`} confirmLabel="Delete" cancelLabel="Cancel" danger
          onConfirm={() => { const v = confirm.v; setConfirm(null); onDelete(v); }}
          onCancel={() => setConfirm(null)}>
          <strong style={{ color: 'var(--text)' }}>v{confirm.v}</strong> will be permanently removed from the version history. This can’t be undone.
        </Modal>
      )}
    </div>
  );
}

function VersionPanel(props) {
  const { doc, collapsed, setCollapsed, tab, setTab, headVersion, viewing, onView, onRestore, onDelete } = props;
  if (collapsed) {
    return (
      <aside className="rpanel collapsed">
        <div className="rp-tabs">
          <Tip label="Expand panel" pos="bottom"><button className="iconbtn" onClick={() => setCollapsed(false)}><Icon name="chevLeft" /></button></Tip>
        </div>
        <div className="rp-rail">
          <Tip label="Info" pos="bottom"><button className="iconbtn" onClick={() => { setCollapsed(false); setTab('info'); }}><Icon name="info" /></button></Tip>
          <Tip label="Versions" pos="bottom"><button className="iconbtn" onClick={() => { setCollapsed(false); setTab('versions'); }}><Icon name="clock" /></button></Tip>
        </div>
      </aside>
    );
  }
  return (
    <aside className="rpanel">
      <div className="rp-tabs">
        <button className={`rp-tab ${tab === 'info' ? 'on' : ''}`} onClick={() => setTab('info')}>Info</button>
        <button className={`rp-tab ${tab === 'versions' ? 'on' : ''}`} onClick={() => setTab('versions')}>Versions</button>
        <Tip label="Collapse" pos="bottom"><button className="iconbtn rp-collapse" onClick={() => setCollapsed(true)}><Icon name="chevRight" /></button></Tip>
      </div>
      <div className="rp-body scroll">
        {tab === 'info' ? <InfoTab doc={doc} /> : <VersionsTab doc={doc} headVersion={headVersion} viewing={viewing} onView={onView} onRestore={onRestore} onDelete={onDelete} />}
      </div>
    </aside>
  );
}

Object.assign(window, { VersionPanel });
