/** Font-matching strategy for in-place text edits. Pure string logic —
 * the PDFObject-graph side (embedded program reuse) lives in mupdfEdit.ts.
 *
 * Strategy (deterministic, in order):
 *  1. If the original font's program is embedded, unsubsetted-usable, and
 *     covers every character of the replacement text, reuse it (mupdfEdit).
 *  2. If the name is one of the standard 14 (or a metric clone: Arial,
 *     Nimbus*, Liberation*, ...), use the matching standard-14 font with
 *     the line's real bold/italic flags.
 *  3. Best effort: serif/sans/mono from the structured-text family plus
 *     bold/italic flags -> standard-14.
 */

import { base14FontName } from './mupdfTransforms';

/** "ABCDEF+Helvetica" -> "Helvetica" (PDF subset-tag prefix). */
export function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '');
}

/** Is this BaseFont name subset-tagged? Subset programs only contain the
 * glyphs the original document used, so they are unsafe for new text unless
 * a coverage check proves otherwise. */
export function hasSubsetPrefix(name: string): boolean {
  return /^[A-Z]{6}\+/.test(name);
}

/** Font description as reported by mupdf structured text for a line. */
export interface SpanFontDesc {
  /** stext font name, e.g. "ABCDEF+TimesNewRomanPSMT" */
  name: string;
  /** stext family: sans-serif | serif | monospace */
  family: string;
  /** stext weight: normal | bold */
  weight: string;
  /** stext style: normal | italic */
  style: string;
}

const EXACT_STANDARD_14 = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
  'Symbol',
  'ZapfDingbats',
]);

/** Name fragments marking metric clones / relatives of the serif and mono
 * standard fonts (URW base-35 names included: NimbusRoman, P052=Palatino,
 * C059=Century, NimbusMonoPS, ...). Sans is the default, so it needs no list. */
const SERIF_HINTS =
  /(times|nimbusroman|liberationserif|georgia|garamond|palatino|p052|c059|century|cambria|bookantiqua|minion|charter)/;
const MONO_HINTS = /(courier|nimbusmono|liberationmono|mono|consolas|menlo|inconsolata)/;

const BOLD_HINTS = /(bold|black|heavy|semibold|demibold|demi(?![a-z])|extrabold)/;
const ITALIC_HINTS = /(italic|oblique)/;

/** Codepoints a replacement string actually needs glyphs for, mirroring
 * escapePdfText: control / non-Latin-1 characters are written as '?'. */
export function editCodepoints(text: string): number[] {
  const out = new Set<number>();
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (code === 10 || code === 13) continue; // escaped, not drawn as glyphs
    out.add(code < 32 || code > 255 ? 63 : code);
  }
  return [...out];
}

/** Choose the standard-14 font for a span: exact standard-14 names pass
 * through unchanged; otherwise classify by name hints + stext family with
 * the line's real bold/italic flags. Deterministic. */
export function pickBase14(font: SpanFontDesc): string {
  const bare = stripSubsetPrefix(font.name);
  if (EXACT_STANDARD_14.has(bare)) return bare;

  const n = bare.toLowerCase().replace(/[^a-z0-9]/g, '');
  const bold = font.weight === 'bold' || BOLD_HINTS.test(n);
  const italic = font.style === 'italic' || ITALIC_HINTS.test(n);
  let family = font.family;
  if (MONO_HINTS.test(n)) family = 'monospace';
  else if (SERIF_HINTS.test(n)) family = 'serif';
  return base14FontName(family, bold ? 'bold' : 'normal', italic ? 'italic' : 'normal');
}
