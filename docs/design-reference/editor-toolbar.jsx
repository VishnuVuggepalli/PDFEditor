/* editor-toolbar.jsx — top toolbar (tools, zoom, undo/redo, save) */

function ZoomControl({ zoom, label, setZoom, fit }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  useOutside(ref, () => setOpen(false), open);
  const presets = [50, 75, 100, 150, 200];
  return (
    <div className="zoom">
      <Tip label="Zoom out" sub="−"><button className="iconbtn" onClick={() => setZoom(Math.max(50, (typeof zoom === 'number' ? zoom : 100) - 25))}><Icon name="minus" size={16} /></button></Tip>
      <div className="zval" ref={ref}>
        <button className="zbtn" onClick={() => setOpen(o => !o)}>{label}<Icon name="chevDown" size={13} /></button>
        {open && (
          <div className="menu zoom-menu" onClick={() => setOpen(false)}>
            {presets.map(p => (
              <button key={p} className={`item ${typeof zoom === 'number' && zoom === p ? 'on' : ''}`} onClick={() => setZoom(p)}>{p}%</button>
            ))}
            <div className="sep" />
            <button className={`item ${zoom === 'fit-width' ? 'on' : ''}`} onClick={() => fit('fit-width')}><span>Fit width</span></button>
            <button className={`item ${zoom === 'fit-page' ? 'on' : ''}`} onClick={() => fit('fit-page')}><span>Fit page</span></button>
          </div>
        )}
      </div>
      <Tip label="Zoom in" sub="+"><button className="iconbtn" onClick={() => setZoom(Math.min(200, (typeof zoom === 'number' ? zoom : 100) + 25))}><Icon name="plus" size={16} /></button></Tip>
    </div>
  );
}

function EditorToolbar(props) {
  const { doc, tool, setTool, dirty, zoom, zoomLabel, setZoom, fit,
    canUndo, canRedo, undo, redo, pendingCount, onSave, onBack,
    onToggleSearch, viewing, toolLabels, onRename, onDuplicate, onDownload, onDelete } = props;
  const readonly = viewing != null;

  return (
    <div className="toolbar">
      <div className="tb-left">
        <Tip label="Back to library"><button className="iconbtn" onClick={onBack}><Icon name="back" /></button></Tip>
        <nav className="crumbs">
          <button className="crumb" onClick={onBack}>Documents</button>
          <Icon name="chevRight" size={13} className="crumb-sep" />
          <button className="tb-filename crumb-file" onClick={() => !readonly && onRename && onRename()} title={readonly ? doc.name : 'Rename'}>
            {dirty && !readonly && <span className="dot" title="Unsaved changes"></span>}
            <span className="nm">{doc.name}</span>
          </button>
        </nav>
        {!readonly && (
          <Kebab align="left" items={[
            { label: 'Rename', icon: 'pen', onClick: onRename },
            { label: 'Duplicate', icon: 'copy', onClick: onDuplicate },
            { label: 'Download', icon: 'download', onClick: onDownload },
            { sep: true },
            { label: 'Delete', icon: 'trash', danger: true, onClick: onDelete },
          ]} />
        )}
      </div>

      <div className={`tb-center ${toolLabels ? 'with-labels' : ''}`}>
        {TOOLS.map(t => (
          <Tip key={t.id} label={t.label} sub={t.enabled ? '' : 'coming soon'}>
            <button
              className={`iconbtn ${tool === t.id ? 'active' : ''} ${toolLabels ? 'labeled' : ''}`}
              disabled={!t.enabled || readonly}
              onClick={() => t.enabled && setTool(t.id)}
              aria-label={t.label}
            ><Icon name={t.icon} />{toolLabels && <span className="tlabel">{t.label}</span>}</button>
          </Tip>
        ))}
      </div>

      <div className="tb-right">
        <Tip label="Search" sub="⌘F"><button className="iconbtn" onClick={onToggleSearch}><Icon name="search" /></button></Tip>
        <ZoomControl zoom={zoom} label={zoomLabel} setZoom={setZoom} fit={fit} />
        <span className="tb-divider"></span>
        <Tip label="Undo" sub="⌘Z"><button className="iconbtn" disabled={!canUndo || readonly} onClick={undo}><Icon name="undo" /></button></Tip>
        <Tip label="Redo" sub="⌘⇧Z"><button className="iconbtn" disabled={!canRedo || readonly} onClick={redo}><Icon name="redo" /></button></Tip>
        <span className="tb-divider"></span>
        <button className="btn primary" disabled={!dirty || readonly} onClick={onSave}>
          <Icon name="save" size={15} />
          Save{pendingCount > 0 && <span className="count">{pendingCount}</span>}
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { EditorToolbar });
