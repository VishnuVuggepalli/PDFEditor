/* data.jsx — mock documents, versions, faux page content, helpers */

/* ---- relative time ---- */
function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return w === 1 ? 'last week' : `${w} weeks ago`;
  const mo = Math.floor(d / 30);
  return mo === 1 ? 'last month' : `${mo} months ago`;
}
const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

/* ---- truncate filename in the middle ---- */
function truncMid(name, max = 26) {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  const head = Math.ceil(keep * 0.6), tail = Math.floor(keep * 0.4);
  return base.slice(0, head) + '…' + base.slice(base.length - tail) + ext;
}

function fmtSize(kb) {
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/* ---- faux page content templates (selectable "text layer") ----
   kind: 'cover' | 'prose' | 'table' | 'placeholder'  */
let _pid = 0;
const pid = () => `pg_${++_pid}`;

function makePages(specs) {
  return specs.map((s, i) => ({ id: pid(), n: i + 1, kind: s, rot: 0, deleted: false }));
}

/* ---- documents ---- */
const NOW = Date.now();
const DOCUMENTS = [
  {
    id: 'fin-q3',
    name: 'Q3-Financial-Report-FINAL.pdf',
    sizeKB: 1228,
    created: NOW - 6 * DAY,
    updated: NOW - 2 * HOUR,
    version: 3,
    hasForms: false,
    encrypted: false,
    pages: makePages(['cover', 'prose', 'table', 'prose', 'placeholder', 'placeholder', 'table', 'prose', 'placeholder', 'placeholder', 'prose', 'placeholder', 'placeholder', 'prose']),
    versions: [
      { v: 3, ts: NOW - 2 * HOUR, summary: 'rotate p2, delete p7', sizeKB: 1228 },
      { v: 2, ts: NOW - 1 * DAY, summary: 'highlight p1, p3', sizeKB: 1305 },
      { v: 1, ts: NOW - 6 * DAY, summary: 'initial upload', sizeKB: 1402 },
    ],
    annots: {
      pg_1: [{ id: 'seed_h1', type: 'highlight', x: 0.105, y: 0.205, w: 0.62, h: 0.058, color: '#fde047', pending: false }],
      pg_2: [{ id: 'seed_c1', type: 'comment', x: 0.82, y: 0.14, text: 'Confirm these figures with the controller before this circulates externally.', pending: false }],
    },
  },
  {
    id: 'spec',
    name: 'Product-Spec-PDFEditor-v2-internal-draft.pdf',
    sizeKB: 642,
    created: NOW - 2 * DAY,
    updated: NOW - 1 * DAY,
    version: 1,
    hasForms: false,
    encrypted: false,
    pages: makePages(['cover', 'prose', 'prose', 'table', 'prose', 'placeholder', 'prose', 'placeholder']),
    versions: [{ v: 1, ts: NOW - 2 * DAY, summary: 'initial upload', sizeKB: 642 }],
  },
  {
    id: 'onboard',
    name: 'New-Hire-Onboarding-Checklist.pdf',
    sizeKB: 188,
    created: NOW - 5 * DAY,
    updated: NOW - 3 * DAY,
    version: 2,
    hasForms: true,
    encrypted: false,
    pages: makePages(['cover', 'forms', 'prose']),
    versions: [
      { v: 2, ts: NOW - 3 * DAY, summary: 'add form fields p2', sizeKB: 188 },
      { v: 1, ts: NOW - 5 * DAY, summary: 'initial upload', sizeKB: 171 },
    ],
  },
  {
    id: 'brand',
    name: 'Brand-Guidelines-2026.pdf',
    sizeKB: 8734,
    created: NOW - 22 * DAY,
    updated: NOW - 9 * DAY,
    version: 5,
    hasForms: false,
    encrypted: false,
    pages: makePages(['cover', 'prose', 'placeholder', 'placeholder', 'prose', 'placeholder', 'placeholder', 'placeholder', 'prose', 'table', 'placeholder', 'placeholder', 'prose', 'placeholder', 'placeholder', 'placeholder', 'prose', 'placeholder', 'placeholder', 'table', 'prose', 'placeholder']),
    versions: [
      { v: 5, ts: NOW - 9 * DAY, summary: 'reorder p3–p6, delete p20', sizeKB: 8734 },
      { v: 4, ts: NOW - 12 * DAY, summary: 'rotate p11, p12', sizeKB: 8910 },
      { v: 3, ts: NOW - 16 * DAY, summary: 'highlight p2, p9, p17', sizeKB: 8902 },
      { v: 2, ts: NOW - 19 * DAY, summary: 'delete p23, p24', sizeKB: 9120 },
      { v: 1, ts: NOW - 22 * DAY, summary: 'initial upload', sizeKB: 9540 },
    ],
  },
  {
    id: 'invoice',
    name: 'Invoice-0042-Acme-Corp.pdf',
    sizeKB: 96,
    created: NOW - 4 * MIN,
    updated: NOW - 4 * MIN,
    version: 1,
    hasForms: false,
    encrypted: false,
    pages: makePages(['table']),
    versions: [{ v: 1, ts: NOW - 4 * MIN, summary: 'initial upload', sizeKB: 96 }],
  },
  {
    id: 'msa',
    name: 'Contract-MSA-Acme-Counter-Signed.pdf',
    sizeKB: 1044,
    created: NOW - 11 * DAY,
    updated: NOW - 30 * MIN,
    version: 4,
    hasForms: true,
    encrypted: true,
    pages: makePages(['cover', 'prose', 'prose', 'prose', 'prose', 'table', 'prose', 'forms', 'prose', 'prose', 'forms']),
    versions: [
      { v: 4, ts: NOW - 30 * MIN, summary: 'fill signature field p11', sizeKB: 1044 },
      { v: 3, ts: NOW - 2 * DAY, summary: 'highlight p6 clause 4.2', sizeKB: 1031 },
      { v: 2, ts: NOW - 6 * DAY, summary: 'comment p3', sizeKB: 1020 },
      { v: 1, ts: NOW - 11 * DAY, summary: 'initial upload', sizeKB: 1018 },
    ],
  },
];

/* ---- deep clone so each editor session is independent ---- */
function loadDoc(id) {
  const d = DOCUMENTS.find(x => x.id === id);
  if (!d) return null;
  return JSON.parse(JSON.stringify(d));
}

const TOOLS = [
  { id: 'select', label: 'Select', icon: 'cursor', enabled: true },
  { id: 'highlight', label: 'Highlight', icon: 'highlight', enabled: true },
  { id: 'comment', label: 'Comment', icon: 'comment', enabled: true },
  { id: 'draw', label: 'Draw', icon: 'pen', enabled: true },
  { id: 'text', label: 'Text', icon: 'text', enabled: true },
  { id: 'shapes', label: 'Shapes', icon: 'shapes', enabled: true },
  { id: 'sign', label: 'Sign', icon: 'sign', enabled: true },
  { id: 'forms', label: 'Forms', icon: 'forms', enabled: true },
];

const ZOOM_PRESETS = [50, 75, 100, 150, 200];

Object.assign(window, { relTime, truncMid, fmtSize, DOCUMENTS, loadDoc, TOOLS, ZOOM_PRESETS });
