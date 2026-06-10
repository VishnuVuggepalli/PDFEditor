/* annotations.jsx — page annotation layer: highlight / comment / draw / text / shapes / signature */

const auid = () => 'an_' + Math.random().toString(36).slice(2, 9);

const ANNOT_COLORS = ['#fde047', '#86efac', '#fca5a5', '#93c5fd', '#d8b4fe'];
const DRAW_COLORS = ['#ef4444', '#2563eb', '#16a34a', '#111827', '#f59e0b'];
const TEXT_SIZES = [14, 18, 26];
const SHAPES = [{ id: 'rect', icon: 'rect' }, { id: 'ellipse', icon: 'ellipse' }, { id: 'line', icon: 'line' }];

/* ---------- floating toolbar ---------- */
function AnnotToolbar({ tool, style, setStyle }) {
  const hints = {
    comment: 'Click anywhere on a page to drop a comment',
    sign: 'Click where you want to place your signature',
    forms: 'Click a form field to fill it in',
  };
  if (hints[tool]) return <div className="annot-bar hint"><span className="ab-label">{hints[tool]}</span></div>;
  if (!['highlight', 'draw', 'text', 'shapes'].includes(tool)) return null;
  const palette = tool === 'highlight' ? ANNOT_COLORS : DRAW_COLORS;
  return (
    <div className="annot-bar">
      <span className="ab-label">{({ highlight: 'Highlight', draw: 'Pen', text: 'Text', shapes: 'Shape' })[tool]}</span>
      {tool === 'shapes' && (
        <>
          <span className="ab-sep"></span>
          <div className="ab-widths">
            {SHAPES.map(s => (
              <button key={s.id} className={'ab-w' + (style.shape === s.id ? ' on' : '')} onClick={() => setStyle(v => ({ ...v, shape: s.id }))} aria-label={s.id}>
                <Icon name={s.icon} size={15} style={{ color: '#fff' }} />
              </button>
            ))}
          </div>
        </>
      )}
      <span className="ab-sep"></span>
      <div className="ab-swatches">
        {palette.map(c => (
          <button key={c} className={'ab-sw' + (style.color === c ? ' on' : '')} style={{ background: c }} onClick={() => setStyle(v => ({ ...v, color: c }))} aria-label={c} />
        ))}
      </div>
      {(tool === 'draw' || tool === 'shapes') && (
        <>
          <span className="ab-sep"></span>
          <div className="ab-widths">
            {[2, 4, 7].map(w => (
              <button key={w} className={'ab-w' + (style.width === w ? ' on' : '')} onClick={() => setStyle(v => ({ ...v, width: w }))} aria-label={w + 'px'}>
                <span className="wdot" style={{ width: w + 2, height: w + 2 }}></span>
              </button>
            ))}
          </div>
        </>
      )}
      {tool === 'text' && (
        <>
          <span className="ab-sep"></span>
          <div className="ab-widths">
            {TEXT_SIZES.map((s, i) => (
              <button key={s} className={'ab-w txt' + (style.size === s ? ' on' : '')} onClick={() => setStyle(v => ({ ...v, size: s }))} aria-label={s + 'px'}>
                <span style={{ fontSize: 11 + i * 3, color: '#fff', fontWeight: 700 }}>A</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- comment pin ---------- */
function CommentPin({ ann, n, open, onOpen, onSave, onDelete, readonly }) {
  const [text, setText] = React.useState(ann.text || '');
  const ref = React.useRef(null);
  React.useEffect(() => { if (open && ref.current) ref.current.focus(); }, [open]);
  return (
    <div className="cm-pin" style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%` }}>
      <button className={'cm-dot' + (open ? ' open' : '')} onClick={(e) => { e.stopPropagation(); onOpen(); }}>{n}</button>
      {open && (
        <div className="cm-pop" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {readonly ? <div className="cm-read">{ann.text || <span className="muted">No comment</span>}</div>
            : <textarea ref={ref} value={text} placeholder="Add a comment…" onChange={(e) => setText(e.target.value)} rows={3} />}
          {!readonly && (
            <div className="cm-acts">
              <button className="cm-del" onClick={() => onDelete()}><Icon name="trash" size={13} />Delete</button>
              <button className="cm-save" onClick={() => onSave(text)}>Save</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- editable text box ---------- */
function TextBox({ ann, scale, onChange, onDelete, readonly, autoFocus }) {
  const ref = React.useRef(null);
  React.useEffect(() => { if (autoFocus && ref.current) { ref.current.focus(); document.execCommand && document.getSelection().selectAllChildren(ref.current); } }, []);
  return (
    <div className="an-text" style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, fontSize: Math.round(ann.size * scale), color: ann.color }}>
      <div ref={ref} className="an-text-edit" contentEditable={!readonly} suppressContentEditableWarning
        data-empty={!ann.text} onBlur={(e) => onChange(e.currentTarget.textContent)}>{ann.text}</div>
      {ann.pending && !readonly && <button className="an-x" onMouseDown={(e) => e.preventDefault()} onClick={() => onDelete()}><Icon name="close" size={11} /></button>}
    </div>
  );
}

/* ---------- signature render ---------- */
function SignRender({ ann, pageW, pageH }) {
  if (ann.mode === 'type') {
    return <div className="an-sign type" style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, width: `${ann.w * 100}%`, height: `${ann.h * 100}%`, color: ann.color, fontSize: Math.round(ann.h * pageH * 0.7) }}>{ann.text}</div>;
  }
  return (
    <div className="an-sign" style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, width: `${ann.w * 100}%`, height: `${ann.h * 100}%` }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
        {(ann.strokes || []).map((s, i) => (
          <path key={i} d={s.map((p, j) => `${j ? 'L' : 'M'}${(p.x * 100).toFixed(1)} ${(p.y * 100).toFixed(1)}`).join(' ')}
            stroke={ann.color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
}

/* ---------- layer ---------- */
function AnnotationLayer({ page, annots, tool, style, pageW, pageH, onAdd, onUpdate, onDelete, onSign, readonly }) {
  const ref = React.useRef(null);
  const [draft, setDraft] = React.useState(null);
  const [openCm, setOpenCm] = React.useState(null);
  const [editText, setEditText] = React.useState(null);
  const list = annots || [];
  const scale = pageW / 660;
  const drawTools = ['highlight', 'comment', 'draw', 'text', 'shapes', 'sign'];
  const active = !readonly && drawTools.includes(tool);

  function rel(e) {
    const r = ref.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }
  function down(e) {
    if (!active || e.button !== 0) return;
    const p = rel(e);
    if (tool === 'comment') { const id = auid(); onAdd({ id, type: 'comment', x: p.x, y: p.y, text: '' }); setOpenCm(id); return; }
    if (tool === 'text') { const id = auid(); onAdd({ id, type: 'text', x: p.x, y: p.y, text: '', size: style.size, color: style.color }); setEditText(id); return; }
    if (tool === 'sign') { onSign(p); return; }
    e.preventDefault();
    if (tool === 'highlight') setDraft({ type: 'highlight', sx: p.x, sy: p.y, x: p.x, y: p.y, w: 0, h: 0, color: style.color });
    else if (tool === 'draw') setDraft({ type: 'draw', pts: [p], color: style.color, width: style.width });
    else if (tool === 'shapes') setDraft({ type: 'shape', shape: style.shape, sx: p.x, sy: p.y, x: p.x, y: p.y, w: 0, h: 0, x2: p.x, y2: p.y, color: style.color, width: style.width });
  }
  function move(e) {
    if (!draft) return;
    const p = rel(e);
    if (draft.type === 'highlight') setDraft(d => ({ ...d, x: Math.min(p.x, d.sx), y: Math.min(p.y, d.sy), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) }));
    else if (draft.type === 'draw') setDraft(d => ({ ...d, pts: [...d.pts, p] }));
    else if (draft.type === 'shape') setDraft(d => ({ ...d, x: Math.min(p.x, d.sx), y: Math.min(p.y, d.sy), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy), x2: p.x, y2: p.y }));
  }
  function up() {
    if (!draft) return;
    if (draft.type === 'highlight' && draft.w > 0.015 && draft.h > 0.006) onAdd({ id: auid(), type: 'highlight', x: draft.x, y: draft.y, w: draft.w, h: draft.h, color: draft.color });
    if (draft.type === 'draw' && draft.pts.length > 2) onAdd({ id: auid(), type: 'draw', pts: draft.pts, color: draft.color, width: draft.width });
    if (draft.type === 'shape') {
      if (draft.shape === 'line') { if (Math.hypot(draft.x2 - draft.sx, draft.y2 - draft.sy) > 0.02) onAdd({ id: auid(), type: 'shape', shape: 'line', sx: draft.sx, sy: draft.sy, x2: draft.x2, y2: draft.y2, color: draft.color, width: draft.width }); }
      else if (draft.w > 0.02 && draft.h > 0.015) onAdd({ id: auid(), type: 'shape', shape: draft.shape, x: draft.x, y: draft.y, w: draft.w, h: draft.h, color: draft.color, width: draft.width });
    }
    setDraft(null);
  }
  const toPath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x * pageW).toFixed(1)} ${(p.y * pageH).toFixed(1)}`).join(' ');
  const comments = list.filter(a => a.type === 'comment');

  function ShapeEl({ a }) {
    if (a.shape === 'line') return null;
    return (
      <div className={'an-shape ' + a.shape} style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`, borderColor: a.color, borderWidth: a.width }}>
        {a.pending && !readonly && <button className="an-x" onClick={() => onDelete(a.id)}><Icon name="close" size={11} /></button>}
      </div>
    );
  }

  return (
    <>
      {/* render layer (under capture) */}
      <div className="annot-render">
        {list.filter(a => a.type === 'highlight').map(a => (
          <div key={a.id} className="an-hl" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`, background: a.color }}>
            {a.pending && !readonly && <button className="an-x" onClick={() => onDelete(a.id)}><Icon name="close" size={11} /></button>}
          </div>
        ))}
        {list.filter(a => a.type === 'shape').map(a => <ShapeEl key={a.id} a={a} />)}
        <svg className="an-svg" width={pageW} height={pageH} viewBox={`0 0 ${pageW} ${pageH}`}>
          {list.filter(a => a.type === 'draw').map(a => <path key={a.id} d={toPath(a.pts)} stroke={a.color} strokeWidth={a.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
          {list.filter(a => a.type === 'shape' && a.shape === 'line').map(a => <line key={a.id} x1={a.sx * pageW} y1={a.sy * pageH} x2={a.x2 * pageW} y2={a.y2 * pageH} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" />)}
          {draft && draft.type === 'draw' && <path d={toPath(draft.pts)} stroke={draft.color} strokeWidth={draft.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
          {draft && draft.type === 'shape' && draft.shape === 'line' && <line x1={draft.sx * pageW} y1={draft.sy * pageH} x2={draft.x2 * pageW} y2={draft.y2 * pageH} stroke={draft.color} strokeWidth={draft.width} strokeLinecap="round" />}
        </svg>
        {list.filter(a => a.type === 'sign').map(a => <SignRender key={a.id} ann={a} pageW={pageW} pageH={pageH} />)}
        {draft && draft.type === 'highlight' && <div className="an-hl draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%`, background: draft.color }} />}
        {draft && draft.type === 'shape' && draft.shape !== 'line' && <div className={'an-shape draft ' + draft.shape} style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%`, borderColor: draft.color, borderWidth: draft.width }} />}
      </div>

      {/* interactive layer: text boxes, sign delete handles, comment pins */}
      <div className="annot-pins">
        {list.filter(a => a.type === 'text').map(a => (
          <TextBox key={a.id} ann={a} scale={scale} readonly={readonly} autoFocus={editText === a.id}
            onChange={(txt) => { if (!txt.trim() && a.pending) onDelete(a.id); else onUpdate(a.id, { text: txt }); }}
            onDelete={() => onDelete(a.id)} />
        ))}
        {list.filter(a => a.type === 'sign' && a.pending && !readonly).map(a => (
          <button key={a.id + '_x'} className="an-x floating" style={{ left: `calc(${(a.x + a.w) * 100}% )`, top: `${a.y * 100}%` }} onClick={() => onDelete(a.id)}><Icon name="close" size={11} /></button>
        ))}
        {comments.map((a, i) => (
          <CommentPin key={a.id} ann={a} n={i + 1} open={openCm === a.id} readonly={readonly}
            onOpen={() => setOpenCm(o => o === a.id ? null : a.id)}
            onSave={(text) => { if (!text.trim()) onDelete(a.id); else onUpdate(a.id, { text }); setOpenCm(null); }}
            onDelete={() => { onDelete(a.id); setOpenCm(null); }} />
        ))}
      </div>

      {/* capture layer */}
      <div ref={ref} className={`annot-capture tool-${tool}`} style={{ pointerEvents: active ? 'auto' : 'none' }}
        onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
        onClick={() => { if (openCm) setOpenCm(null); }} />
    </>
  );
}

/* ---------- signature modal ---------- */
function SignatureModal({ onApply, onCancel }) {
  const [mode, setMode] = React.useState('type');
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('#1d4ed8');
  const canvasRef = React.useRef(null);
  const strokesRef = React.useRef([]);
  const drawingRef = React.useRef(false);
  const [hasInk, setHasInk] = React.useState(false);
  const ref = React.useRef(null);
  useOutside(ref, onCancel, true);

  React.useEffect(() => {
    if (mode !== 'draw') return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    redraw();
  }, [mode, color]);

  function redraw() {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    strokesRef.current.forEach(s => { ctx.beginPath(); s.forEach((p, i) => { const X = p.x * c.width, Y = p.y * c.height; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke(); });
  }
  function pt(e) { const r = canvasRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
  function dn(e) { drawingRef.current = true; strokesRef.current.push([pt(e)]); }
  function mv(e) { if (!drawingRef.current) return; strokesRef.current[strokesRef.current.length - 1].push(pt(e)); setHasInk(true); redraw(); }
  function end() { drawingRef.current = false; }
  function clear() { strokesRef.current = []; setHasInk(false); redraw(); }

  const canApply = mode === 'type' ? name.trim().length > 0 : hasInk;
  function apply() {
    if (!canApply) return;
    if (mode === 'type') onApply({ mode: 'type', text: name.trim(), color });
    else onApply({ mode: 'draw', strokes: strokesRef.current.filter(s => s.length > 1), color });
  }

  return (
    <div className="modal-scrim">
      <div className="modal sig-modal" ref={ref} role="dialog" aria-modal="true">
        <div className="m-head"><div className="m-title">Add your signature</div></div>
        <div className="m-body" style={{ paddingBottom: 4 }}>
          <div className="sig-tabs">
            <button className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}>Type</button>
            <button className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}>Draw</button>
          </div>
          {mode === 'type' ? (
            <div className="sig-type">
              <input autoFocus value={name} placeholder="Type your name" onChange={(e) => setName(e.target.value)} />
              <div className="sig-preview" style={{ color }}>{name || 'Your signature'}</div>
            </div>
          ) : (
            <div className="sig-draw">
              <canvas ref={canvasRef} width={460} height={150} onMouseDown={dn} onMouseMove={mv} onMouseUp={end} onMouseLeave={end}></canvas>
              <button className="sig-clear" onClick={clear}>Clear</button>
            </div>
          )}
          <div className="sig-colors">
            {['#1d4ed8', '#111827', '#b91c1c'].map(c => (
              <button key={c} className={'sig-sw' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </div>
        <div className="m-foot">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!canApply} onClick={apply}>Place signature</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AnnotationLayer, AnnotToolbar, SignatureModal, auid, ANNOT_COLORS, DRAW_COLORS });
