/* shared.jsx — icon set + UI primitives (Icon, Tooltip, Kebab, Modal, Toasts) */
const { useState, useRef, useEffect, useCallback, createContext, useContext } = React;

/* ---------------- Icons (simple line icons, 24x24 stroke) ---------------- */
const PATHS = {
  cursor:    '<path d="M5 3l6 16 2.2-6.2L19.5 11 5 3z"/>',
  highlight: '<path d="M4 20h6"/><path d="M12.5 5.5l4 4-7 7H5.5v-4l7-7z"/><path d="M14 4l2 2"/>',
  comment:   '<path d="M5 5h14v10H9l-4 4V5z"/>',
  pen:       '<path d="M16.5 4.5l3 3L8 19l-4 1 1-4L16.5 4.5z"/>',
  shapes:    '<rect x="3.5" y="3.5" width="8" height="8" rx="1"/><circle cx="16.5" cy="16.5" r="4"/>',
  forms:     '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  text:      '<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
  sign:      '<path d="M3 17.5c2.5 0 3-9 5-9s2 7 3.5 7 2-5 3.5-5 2 3 3 3"/><path d="M3 20.5h18"/>',
  rect:      '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse:   '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  line:      '<path d="M5 18L19 6"/>',
  back:      '<path d="M15 5l-7 7 7 7"/>',
  search:    '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  chevDown:  '<path d="M6 9l6 6 6-6"/>',
  chevRight: '<path d="M9 6l6 6-6 6"/>',
  chevLeft:  '<path d="M15 6l-6 6 6 6"/>',
  chevUp:    '<path d="M6 15l6-6 6 6"/>',
  kebab:     '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  rotL:      '<path d="M4 8a8 8 0 1 1-1 4"/><path d="M4 4v4h4"/>',
  rotR:      '<path d="M20 8a8 8 0 1 0 1 4"/><path d="M20 4v4h-4"/>',
  trash:     '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  restore:   '<path d="M4 12a8 8 0 1 1 2.5 5.8"/><path d="M4 16v-4h4"/>',
  download:  '<path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  copy:      '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  upload:    '<path d="M12 20V9M7 13l5-5 5 5"/><path d="M5 5h14"/>',
  undo:      '<path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-3"/>',
  redo:      '<path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 0 0 0 10h3"/>',
  save:      '<path d="M5 4h11l3 3v13H5V4z"/><path d="M8 4v5h7M8 20v-6h8v6"/>',
  plus:      '<path d="M12 5v14M5 12h14"/>',
  minus:     '<path d="M5 12h14"/>',
  close:     '<path d="M6 6l12 12M18 6L6 18"/>',
  check:     '<path d="M5 12l4.5 4.5L19 7"/>',
  checkCircle:'<circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  alert:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
  file:      '<path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4"/>',
  fileText:  '<path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6M9 18h4"/>',
  pages:     '<rect x="5" y="3" width="11" height="15" rx="1.5"/><path d="M8 21h11V8"/>',
  lock:      '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  info:      '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  clock:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  eye:       '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  fitWidth:  '<path d="M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3"/><rect x="3.5" y="4" width="17" height="16" rx="1.5"/>',
  fitPage:   '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M8 8l-2 2 2 2M16 8l2 2-2 2"/>',
  drag:      '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  moon:      '<path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z"/>',
  sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/>',
};

function Icon({ name, size = 18, stroke = 2, fill = false, style, className }) {
  const path = PATHS[name] || '';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style}
      dangerouslySetInnerHTML={{ __html: path }} />
  );
}

/* ---------------- Tooltip ---------------- */
function Tip({ label, sub, pos = 'bottom', children }) {
  return (
    <span className="tip-wrap">
      {children}
      <span className={`tip ${pos}`}>{label}{sub && <span className="sub">{sub}</span>}</span>
    </span>
  );
}

/* ---------------- Outside-click hook ---------------- */
function useOutside(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return;
    function h(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    function esc(e) { if (e.key === 'Escape') onClose(); }
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, [active]);
}

/* ---------------- Kebab menu (portaled, never clipped) ---------------- */
function Kebab({ items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  function place() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = 184;
    const estH = items.filter(i => !i.sep).length * 35 + items.filter(i => i.sep).length * 11 + 10;
    let left = align === 'right' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = r.bottom + 4;
    if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - 4);
    setPos({ left, top, width });
  }
  useEffect(() => {
    if (!open) return;
    place();
    function h(e) { if (menuRef.current && !menuRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) setOpen(false); }
    function esc(e) { if (e.key === 'Escape') setOpen(false); }
    function rep() { place(); }
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', rep, true);
    window.addEventListener('resize', rep);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', rep, true); window.removeEventListener('resize', rep); };
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef} className="iconbtn" onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} aria-label="More">
        <Icon name="kebab" />
      </button>
      {open && pos && ReactDOM.createPortal(
        <div ref={menuRef} className="menu" style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }} onClick={(e) => e.stopPropagation()}>
          {items.map((it, i) => it.sep
            ? <div className="sep" key={i} />
            : <button key={i} className={`item ${it.danger ? 'danger' : ''}`} onClick={() => { it.onClick && it.onClick(); setOpen(false); }}>
                {it.icon && <Icon name={it.icon} />}{it.label}
              </button>
          )}
        </div>, document.body)}
    </div>
  );
}

/* ---------------- Modal ---------------- */
function Modal({ title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, danger }) {
  const ref = useRef(null);
  useOutside(ref, onCancel, true);
  useEffect(() => {
    function k(e) { if (e.key === 'Enter') onConfirm(); }
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onConfirm]);
  return (
    <div className="modal-scrim">
      <div className="modal" ref={ref} role="dialog" aria-modal="true">
        <div className="m-head"><div className="m-title">{title}</div></div>
        <div className="m-body">{children}</div>
        <div className="m-foot">
          <button className="btn" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn primary`} style={danger ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : null} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Toasts (context) ---------------- */
const ToastCtx = createContext(null);
function useToast() { return useContext(ToastCtx); }

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, { id, ...t }]);
    setTimeout(() => setToasts(ts => ts.map(x => x.id === id ? { ...x, out: true } : x)), (t.duration || 3600));
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), (t.duration || 3600) + 250);
  }, []);
  const remove = (id) => setToasts(ts => ts.filter(x => x.id !== id));
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type || 'success'} ${t.out ? 'out' : ''}`}>
            <span className="ico"><Icon name={t.type === 'error' ? 'alert' : 'checkCircle'} size={20} /></span>
            <div className="body">
              <div className="t-title">{t.title}</div>
              {t.msg && <div className="t-msg">{t.msg}</div>}
            </div>
            <button className="iconbtn t-close" style={{ width: 22, height: 22 }} onClick={() => remove(t.id)}><Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

Object.assign(window, { Icon, Tip, Kebab, Modal, useOutside, ToastProvider, useToast });
