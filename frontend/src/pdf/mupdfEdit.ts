/** In-place text edit against the live PDFDocument: redact the span's
 * region (true content removal), then draw the replacement via an appended
 * content stream. Shared by the mupdf worker and the node-side font
 * fidelity tests, so the exact shipped edit path is what gets tested.
 *
 * Font strategy (see mupdfFonts.ts): reuse the original embedded program
 * when it provably covers the replacement text; otherwise the closest
 * standard-14 font with the line's real bold/italic flags.
 */

import type * as MU from 'mupdf';
import type { TextSpanInfo } from './engineApi';
import { editCodepoints, pickBase14, stripSubsetPrefix } from './mupdfFonts';
import { approxBaseline, buildEditContentStream } from './mupdfTransforms';

type Mupdf = typeof MU;

/** How the replacement font was chosen (logged + asserted in tests). */
export interface EditFontChoice {
  ref: MU.PDFObject;
  /** 'embedded' = original program re-embedded; 'base14' = metric match */
  strategy: 'embedded' | 'base14';
  /** font name actually used for the replacement text */
  name: string;
}

/** Find the page-resource font whose BaseFont matches the structured-text
 * font name (exact first, then ignoring the subset tag). */
export function findResourceFont(pageObj: MU.PDFObject, stextName: string): MU.PDFObject | null {
  const fonts = pageObj.getInheritable('Resources').get('Font');
  if (!fonts.isDictionary()) return null;
  let exact: MU.PDFObject | null = null;
  let stripped: MU.PDFObject | null = null;
  const bare = stripSubsetPrefix(stextName);
  fonts.forEach((val) => {
    const base = val.get('BaseFont');
    if (!base.isName()) return;
    const name = base.asName();
    if (name === stextName) exact ??= val;
    else if (stripSubsetPrefix(name) === bare) stripped ??= val;
  });
  return exact ?? stripped;
}

/** Extract the embedded font program bytes (FontFile/2/3) from a font dict,
 * descending into DescendantFonts for Type0 fonts. Null when not embedded. */
export function extractFontProgram(fontDict: MU.PDFObject): Uint8Array | null {
  let desc = fontDict.get('FontDescriptor');
  if (!desc.isDictionary()) {
    const descendants = fontDict.get('DescendantFonts');
    if (!descendants.isArray() || descendants.length < 1) return null;
    const descendant = descendants.get(0);
    if (!descendant.isDictionary()) return null;
    desc = descendant.get('FontDescriptor');
    if (!desc.isDictionary()) return null;
  }
  for (const key of ['FontFile2', 'FontFile3', 'FontFile']) {
    const ff = desc.get(key);
    if (ff.isStream()) {
      try {
        return ff.readStream().asUint8Array();
      } catch {
        return null; // corrupt stream: treat as not embedded
      }
    }
  }
  return null;
}

/** Reuse the original embedded program if its cmap still covers every
 * character of the replacement text. Subsetted programs usually fail this
 * check (subsetting strips the cmap or drops glyphs) — that is exactly why
 * the coverage gate exists: a reused font must never draw notdef boxes. */
function tryEmbeddedFont(
  mu: Mupdf,
  doc: MU.PDFDocument,
  pageObj: MU.PDFObject,
  span: TextSpanInfo,
  newText: string,
): EditFontChoice | null {
  const original = findResourceFont(pageObj, span.fontName);
  if (!original) return null;
  const program = extractFontProgram(original);
  if (!program) return null;
  const bare = stripSubsetPrefix(span.fontName);
  try {
    const font = new mu.Font(bare, program);
    const covered = editCodepoints(newText).every((cp) => font.encodeCharacter(cp) !== 0);
    if (!covered) return null;
    return { ref: doc.addSimpleFont(font), strategy: 'embedded', name: bare };
  } catch {
    return null; // program unparseable by fz_new_font: fall back
  }
}

/** Pick the font for the replacement text. Deterministic: embedded reuse
 * when provably safe, else standard-14 metric matching. */
export function chooseEditFont(
  mu: Mupdf,
  doc: MU.PDFDocument,
  pageObj: MU.PDFObject,
  span: TextSpanInfo,
  newText: string,
): EditFontChoice {
  const embedded = tryEmbeddedFont(mu, doc, pageObj, span, newText);
  if (embedded) return embedded;
  const name = pickBase14({
    name: span.fontName,
    family: span.fontFamily,
    weight: span.fontWeight,
    style: span.fontStyle,
  });
  return { ref: doc.addSimpleFont(new mu.Font(name)), strategy: 'base14', name };
}

/** Redact the span's region, draw newText in its place, return the complete
 * edited PDF bytes plus the font decision that was applied. */
export function replaceTextInPage(
  mu: Mupdf,
  doc: MU.PDFDocument,
  page: MU.PDFPage,
  span: TextSpanInfo,
  newText: string,
): { bytes: Uint8Array; font: { strategy: EditFontChoice['strategy']; name: string } | null } {
  const annot = page.createAnnotation('Redact');
  annot.setRect(span.fitzBox);
  page.applyRedactions(
    false,
    mu.PDFPage.REDACT_IMAGE_NONE,
    mu.PDFPage.REDACT_LINE_ART_NONE,
    mu.PDFPage.REDACT_TEXT_REMOVE,
  );

  let chosen: EditFontChoice | null = null;
  if (newText.trim().length > 0) {
    const pageObj = page.getObject();
    chosen = chooseEditFont(mu, doc, pageObj, span, newText);
    let res = pageObj.get('Resources');
    if (!res.isDictionary()) {
      res = doc.newDictionary();
      pageObj.put('Resources', res);
    }
    let fonts = res.get('Font');
    if (!fonts.isDictionary()) {
      fonts = doc.newDictionary();
      res.put('Font', fonts);
    }
    let resName = 'FzEdit';
    for (let i = 0; !fonts.get(resName).isNull(); i++) resName = `FzEdit${i}`;
    fonts.put(resName, chosen.ref);

    const baseline = approxBaseline(span.bbox[1], span.fontSize);
    const fragment = buildEditContentStream(resName, span.fontSize, span.bbox[0], baseline, newText);
    const extra = doc.addStream(fragment, {});
    const contents = pageObj.get('Contents');
    if (contents.isArray()) {
      contents.push(extra);
    } else {
      const arr = doc.newArray();
      arr.push(contents);
      arr.push(extra);
      pageObj.put('Contents', arr);
    }
  }

  const buf = doc.saveToBuffer('garbage,compress');
  try {
    return {
      bytes: buf.asUint8Array().slice(),
      font: chosen ? { strategy: chosen.strategy, name: chosen.name } : null,
    };
  } finally {
    buf.destroy();
  }
}
