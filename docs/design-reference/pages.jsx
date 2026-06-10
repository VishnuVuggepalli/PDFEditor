/* pages.jsx — faux PDF page content + thumbnails + search highlight helper */
const { useMemo: _uM } = React;

/* escape for regex */
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* highlight(text, ctx) — ctx = { q, active, counter:{i}, refs:[] }
   increments a shared counter so the viewer can target the active match. */
function highlight(text, ctx) {
  if (!ctx || !ctx.q) return text;
  const re = new RegExp('(' + escRe(ctx.q) + ')', 'ig');
  const out = []; let last = 0, m, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const idx = ctx.counter.i++;
    const active = idx === ctx.active;
    out.push(
      <mark key={'m' + idx + '_' + (k++)} className={'hl' + (active ? ' active' : '')}
        ref={(el) => { if (el) ctx.refs[idx] = el; }}>{m[0]}</mark>
    );
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* count matches in a plain string */
function countMatches(text, q) {
  if (!q) return 0;
  const m = text.match(new RegExp(escRe(q), 'ig'));
  return m ? m.length : 0;
}

/* ---- text content by page kind ---- */
const LOREM = "The quarterly review consolidates performance across all operating segments. Revenue grew on the strength of recurring contracts, while operating expenses remained disciplined relative to prior guidance. Management expects the favorable trend to continue into the next fiscal period, supported by improved retention and a healthier pipeline.";
const LOREM2 = "Each line item below has been reconciled against the general ledger and reviewed by an independent party. Figures are presented in thousands of dollars unless otherwise noted. Percentages reflect year-over-year change and may not sum due to rounding.";

function pageText(page) {
  const n = page.n;
  switch (page.kind) {
    case 'cover':
      return {
        kind: 'cover',
        eyebrow: 'CONFIDENTIAL — INTERNAL',
        title: 'Quarterly Performance Review',
        subtitle: 'Financial summary and operating highlights',
        meta: ['Prepared by Finance', 'Fiscal Q3 2026', `Document page ${n}`],
      };
    case 'prose':
      return {
        kind: 'prose',
        h: `Section ${n}. Operating Summary`,
        paras: [LOREM, LOREM2],
        bullets: ['Recurring revenue mix improved over the period.', 'Gross margin held steady within the target band.', 'Headcount investments concentrated in product and support.'],
      };
    case 'table':
      return {
        kind: 'table',
        h: `Schedule ${n} — Selected Financial Data`,
        cols: ['Line item', 'Current', 'Prior', 'Δ %'],
        rows: [
          ['Total revenue', '24,810', '21,440', '+15.7'],
          ['Cost of revenue', '7,932', '7,108', '+11.6'],
          ['Gross profit', '16,878', '14,332', '+17.8'],
          ['Operating expenses', '11,204', '10,690', '+4.8'],
          ['Operating income', '5,674', '3,642', '+55.8'],
          ['Net income', '4,318', '2,901', '+48.8'],
        ],
      };
    case 'forms':
      return {
        kind: 'forms',
        h: `Form ${n} — Acknowledgement`,
        fields: [
          { label: 'Full legal name', value: '' },
          { label: 'Employee ID', value: '' },
          { label: 'Start date', value: '' },
          { label: 'Signature', value: '', sig: true },
        ],
      };
    default:
      return { kind: 'placeholder', n };
  }
}

/* flatten a page's text to one string (for match counting) */
function pagePlainText(page) {
  const t = pageText(page);
  switch (t.kind) {
    case 'cover': return [t.eyebrow, t.title, t.subtitle, ...t.meta].join(' ');
    case 'prose': return [t.h, ...t.paras, ...t.bullets].join(' ');
    case 'table': return [t.h, ...t.cols, ...t.rows.flat()].join(' ');
    case 'forms': return [t.h, ...t.fields.map(f => f.label)].join(' ');
    default: return '';
  }
}

/* ---- full page content (in viewer) ---- */
function PageContent({ page, ctx, tool, annots, readonly, onFormFill }) {
  const t = pageText(page);
  const H = (s) => highlight(s, ctx);
  const fills = {};
  (annots || []).forEach(a => { if (a.type === 'formfill') fills[a.field] = a.value; });
  const formActive = tool === 'forms' && !readonly;
  if (t.kind === 'cover') {
    return (
      <div className="pc pc-cover">
        <div className="pc-rule" />
        <div className="pc-eyebrow">{H(t.eyebrow)}</div>
        <h1>{H(t.title)}</h1>
        <p className="pc-sub">{H(t.subtitle)}</p>
        <div className="pc-cover-art" />
        <div className="pc-meta">{t.meta.map((m, i) => <div key={i}>{H(m)}</div>)}</div>
      </div>
    );
  }
  if (t.kind === 'prose') {
    return (
      <div className="pc">
        <h2>{H(t.h)}</h2>
        {t.paras.map((p, i) => <p key={i}>{H(p)}</p>)}
        <ul>{t.bullets.map((b, i) => <li key={i}>{H(b)}</li>)}</ul>
        <p>{H(LOREM)}</p>
      </div>
    );
  }
  if (t.kind === 'table') {
    return (
      <div className="pc">
        <h2>{H(t.h)}</h2>
        <table className="pc-table">
          <thead><tr>{t.cols.map((c, i) => <th key={i} style={i ? { textAlign: 'right' } : null}>{H(c)}</th>)}</tr></thead>
          <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={j ? { textAlign: 'right' } : null} className={j ? 'tnum' : ''}>{H(c)}</td>)}</tr>)}</tbody>
        </table>
        <p style={{ marginTop: 20 }}>{H(LOREM2)}</p>
      </div>
    );
  }
  if (t.kind === 'forms') {
    return (
      <div className="pc">
        <h2>{H(t.h)}</h2>
        <p>{H('Please complete each field below. Fields marked with an asterisk are required.')}</p>
        <div className={'pc-form' + (formActive ? ' active' : '')}>
          {t.fields.map((f, i) => (
            <div className="pc-field" key={i}>
              <label>{H(f.label)}{f.sig ? '' : ' *'}</label>
              <input
                className={'pc-fill' + (f.sig ? ' sig' : '')}
                value={fills[i] || ''} disabled={!formActive}
                placeholder={formActive ? (f.sig ? 'Type to sign' : 'Type here…') : ''}
                onChange={(e) => onFormFill && onFormFill(i, e.target.value)} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  /* placeholder */
  return (
    <div className="pc pc-ph">
      <div className="ph-bars">
        {Array.from({ length: 14 }).map((_, i) => <span key={i} style={{ width: `${[92, 78, 96, 60, 88, 72, 94, 50, 84, 90, 66, 82, 40, 70][i]}%` }} />)}
      </div>
    </div>
  );
}

/* ---- mini schematic thumbnail ---- */
function ThumbContent({ page }) {
  const k = page.kind;
  if (k === 'cover') return (
    <div className="th th-cover"><span className="th-t" /><span className="th-s" /><span className="th-art" /></div>
  );
  if (k === 'table') return (
    <div className="th"><span className="th-h" />
      <div className="th-grid">{Array.from({ length: 12 }).map((_, i) => <span key={i} />)}</div>
    </div>
  );
  if (k === 'forms') return (
    <div className="th"><span className="th-h" />
      {Array.from({ length: 4 }).map((_, i) => <span key={i} className="th-fld" />)}
    </div>
  );
  if (k === 'prose') return (
    <div className="th"><span className="th-h" />
      {Array.from({ length: 8 }).map((_, i) => <span key={i} className="th-l" style={{ width: `${[96, 90, 94, 70, 88, 92, 60, 84][i]}%` }} />)}
    </div>
  );
  return (
    <div className="th">{Array.from({ length: 9 }).map((_, i) => <span key={i} className="th-l" style={{ width: `${[94, 80, 90, 64, 86, 74, 92, 50, 82][i]}%` }} />)}</div>
  );
}

Object.assign(window, { PageContent, ThumbContent, highlight, countMatches, pagePlainText });
