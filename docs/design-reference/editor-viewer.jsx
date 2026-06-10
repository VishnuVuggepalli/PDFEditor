/* editor-viewer.jsx — center continuous page viewer + search */

const BASE_W = 660; // page width at 100%

function scrollElIntoViewer(viewer, el, block = 'center') {
  if (!viewer || !el) return;
  const vr = viewer.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  let top;
  if (block === 'start') top = viewer.scrollTop + (er.top - vr.top) - 28;
  else top = viewer.scrollTop + (er.top - vr.top) - (vr.height - er.height) / 2;
  viewer.scrollTo({ top, behavior: 'smooth' });
}

function SearchPopover({ q, setQ, count, active, setActive, onClose }) {
  const inputRef = React.useRef(null);
  React.useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);
  const has = q && count > 0;
  function nav(d) { if (count > 0) setActive((active + d + count) % count); }
  return (
    <div className="search-pop" onKeyDown={(e) => {
      if (e.key === 'Enter') { e.preventDefault(); nav(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') onClose();
    }}>
      <Icon name="search" size={15} style={{ color: 'var(--text-3)' }} />
      <input ref={inputRef} value={q} placeholder="Find in document"
        onChange={(e) => setQ(e.target.value)} />
      <span className="cnt">{q ? (has ? `${active + 1} / ${count}` : '0 / 0') : ''}</span>
      <span className="sp-sep"></span>
      <button className="iconbtn" disabled={!has} onClick={() => nav(-1)} aria-label="Previous"><Icon name="chevUp" size={16} /></button>
      <button className="iconbtn" disabled={!has} onClick={() => nav(1)} aria-label="Next"><Icon name="chevDown" size={16} /></button>
      <button className="iconbtn" onClick={onClose} aria-label="Close search"><Icon name="close" size={15} /></button>
    </div>
  );
}

function Viewer(props) {
  const { pages, zoom, jumpToken, onActivePage, search, setSearchQ, setSearchActive,
    setSearchCount, closeSearch, viewing, onExitVersion,
    tool, annots, annotStyle, setAnnotStyle, onAddAnnot, onUpdateAnnot, onDeleteAnnot, onRequestSign, onFormFill } = props;
  const viewerRef = React.useRef(null);
  const pageRefs = React.useRef({});
  const [dims, setDims] = React.useState({ w: 900, h: 700 });

  // measure container
  React.useEffect(() => {
    const el = viewerRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // page width from zoom
  let pageW;
  if (zoom === 'fit-width') pageW = Math.max(320, dims.w - 64);
  else if (zoom === 'fit-page') pageW = Math.max(320, (dims.h - 64) * (8.5 / 11));
  else pageW = BASE_W * (zoom / 100);
  pageW = Math.min(pageW, 1100);
  const pageH = pageW * (11 / 8.5);

  // active page on scroll
  React.useEffect(() => {
    const el = viewerRef.current; if (!el) return;
    let raf = 0;
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const center = el.scrollTop + el.clientHeight / 2;
        let best = null, bestD = Infinity;
        pages.forEach(p => {
          const node = pageRefs.current[p.id];
          if (!node) return;
          const mid = node.offsetTop + node.offsetHeight / 2;
          const d = Math.abs(mid - center);
          if (d < bestD) { bestD = d; best = p.id; }
        });
        if (best) onActivePage(best);
      });
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [pages]);

  // external jump (sidebar click / keyboard)
  React.useEffect(() => {
    if (!jumpToken) return;
    const node = pageRefs.current[jumpToken.id];
    if (node) scrollElIntoViewer(viewerRef.current, node, 'start');
  }, [jumpToken]);

  // search: build shared ctx, compute count
  const ctx = { q: search.q.trim(), active: search.active, counter: { i: 0 }, refs: [] };
  let count = 0;
  if (ctx.q) pages.forEach(p => { count += countMatches(pagePlainText(p), ctx.q); });

  React.useEffect(() => { setSearchCount(count); }, [count, search.q]);

  // scroll active match into view
  React.useEffect(() => {
    if (!ctx.q || count === 0) return;
    const el = ctx.refs[search.active];
    if (el) scrollElIntoViewer(viewerRef.current, el, 'center');
  }, [search.active, search.q]);

  // current page number among visible
  const visible = pages;
  const activeIdx = Math.max(0, visible.findIndex(p => p.id === props.activeId));

  return (
    <div className="viewer-wrap">
      {viewing == null && <AnnotToolbar tool={tool} style={annotStyle} setStyle={setAnnotStyle} />}
      {viewing != null && (
        <div className="amber-banner">
          <span><Icon name="eye" size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Viewing v{viewing} (read-only)</span>
          <button onClick={onExitVersion}><Icon name="back" size={14} />Back to current</button>
        </div>
      )}
      <div className="viewer scroll" ref={viewerRef}>
        {visible.length === 0 ? (
          <div className="viewer-empty">All pages are pending deletion. Restore a page or save to continue.</div>
        ) : (
          <div className="viewer-pages">
            {visible.map((p, i) => {
              const rot = ((p.rot % 360) + 360) % 360;
              const rotated = rot === 90 || rot === 270;
              return (
                <div key={p.id} ref={(el) => { pageRefs.current[p.id] = el; }}
                  className={`sheet ${rot ? 'rot' + rot : ''}`}
                  style={{ width: pageW, height: pageH, padding: pageW * 0.085,
                    ...(rotated ? { margin: `${(pageH - pageW) / 2}px 0` } : null) }}>
                  <span className="sheet-tag">{p.kind}</span>
                  <PageContent page={p} ctx={ctx} tool={viewing != null ? 'select' : tool}
                    annots={(annots || {})[p.id]} readonly={viewing != null}
                    onFormFill={(field, val) => onFormFill(p.id, field, val)} />
                  <AnnotationLayer
                    page={p} annots={(annots || {})[p.id]} tool={viewing != null ? 'select' : tool}
                    style={annotStyle} pageW={pageW} pageH={pageH} readonly={viewing != null}
                    onAdd={(a) => onAddAnnot(p.id, a)}
                    onUpdate={(id, patch) => onUpdateAnnot(p.id, id, patch)}
                    onDelete={(id) => onDeleteAnnot(p.id, id)}
                    onSign={(pt) => onRequestSign(p.id, pt)} />
                </div>
              );
            })}
          </div>
        )}
        {search.open && (
          <SearchPopover q={search.q} setQ={setSearchQ} count={count}
            active={search.active} setActive={setSearchActive} onClose={closeSearch} />
        )}
      </div>
      {visible.length > 0 && (
        <div className="page-pill">{activeIdx + 1} / {visible.length}</div>
      )}
    </div>
  );
}

Object.assign(window, { Viewer });
