/** CSS equivalents of the backend's core-14 font tokens, for WYSIWYG
 * rendering of pending (not yet saved) text annotations. */
export function fontTokenToCss(token: string | undefined): {
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
} {
  const t = token ?? 'helvetica';
  const family = t.startsWith('times')
    ? '"Times New Roman", Times, serif'
    : t.startsWith('courier')
      ? '"Courier New", Courier, monospace'
      : 'Helvetica, Arial, sans-serif';
  return {
    fontFamily: family,
    fontWeight: t.includes('bold') ? 700 : 400,
    fontStyle: t.includes('italic') ? 'italic' : 'normal',
  };
}
