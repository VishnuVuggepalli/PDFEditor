/** Formatting helpers ported from the design's data.jsx. */

export function relTime(iso: string | number): string {
  const ts = typeof iso === 'number' ? iso : Date.parse(iso);
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

/** Truncate a filename in the middle, preserving the extension. */
export function truncMid(name: string, max = 26): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  const head = Math.ceil(keep * 0.6);
  const tail = Math.floor(keep * 0.4);
  return `${base.slice(0, head)}…${base.slice(base.length - tail)}${ext}`;
}

/** Format a byte count for display. */
export function fmtBytes(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
