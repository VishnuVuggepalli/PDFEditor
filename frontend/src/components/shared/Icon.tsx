/** Line icon set from the design (24x24 stroke paths). */
import type { CSSProperties } from 'react';

const PATHS: Record<string, string> = {
  cursor: '<path d="M5 3l6 16 2.2-6.2L19.5 11 5 3z"/>',
  highlight: '<path d="M4 20h6"/><path d="M12.5 5.5l4 4-7 7H5.5v-4l7-7z"/><path d="M14 4l2 2"/>',
  comment: '<path d="M5 5h14v10H9l-4 4V5z"/>',
  pen: '<path d="M16.5 4.5l3 3L8 19l-4 1 1-4L16.5 4.5z"/>',
  shapes: '<rect x="3.5" y="3.5" width="8" height="8" rx="1"/><circle cx="16.5" cy="16.5" r="4"/>',
  forms: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  text: '<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
  sign: '<path d="M3 17.5c2.5 0 3-9 5-9s2 7 3.5 7 2-5 3.5-5 2 3 3 3"/><path d="M3 20.5h18"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  line: '<path d="M5 18L19 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  chevRight: '<path d="M9 6l6 6-6 6"/>',
  chevLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevUp: '<path d="M6 15l6-6 6 6"/>',
  kebab: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  rotL: '<path d="M4 8a8 8 0 1 1-1 4"/><path d="M4 4v4h4"/>',
  rotR: '<path d="M20 8a8 8 0 1 0 1 4"/><path d="M20 4v4h-4"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  restore: '<path d="M4 12a8 8 0 1 1 2.5 5.8"/><path d="M4 16v-4h4"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  upload: '<path d="M12 20V9M7 13l5-5 5 5"/><path d="M5 5h14"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 0 0 0 10h3"/>',
  save: '<path d="M5 4h11l3 3v13H5V4z"/><path d="M8 4v5h7M8 20v-6h8v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l4.5 4.5L19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
  file: '<path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4"/>',
  fileText: '<path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6M9 18h4"/>',
  pages: '<rect x="5" y="3" width="11" height="15" rx="1.5"/><path d="M8 21h11V8"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  fitWidth:
    '<path d="M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3"/><rect x="3.5" y="4" width="17" height="16" rx="1.5"/>',
  fitPage: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M8 8l-2 2 2 2M16 8l2 2-2 2"/>',
  drag: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  merge: '<path d="M7 4v6a4 4 0 0 0 4 4h2"/><path d="M7 20v-6"/><path d="M17 11l3 3-3 3"/>',
  split: '<path d="M4 4h7v16H4z"/><path d="M15 4h5M15 20h5M20 4v5M20 15v5"/>',
  loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  moon: '<path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/>',
};

export type IconName = keyof typeof PATHS & string;

interface Props {
  name: string;
  size?: number;
  stroke?: number;
  fill?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function Icon({ name, size = 18, stroke = 2, fill = false, style, className }: Props) {
  const path = PATHS[name] ?? '';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: path }}
    />
  );
}
