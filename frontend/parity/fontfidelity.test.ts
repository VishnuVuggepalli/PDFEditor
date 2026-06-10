/** Font fidelity of in-place text edits, against real mupdf wasm. Runs the
 * exact shipped edit path (replaceTextInPage) and asserts the deterministic
 * font strategy:
 *  - embedded original program is reused when it covers the new text
 *  - subsetted programs (broken cmaps) fall back to standard-14 matching
 *  - standard-14 originals keep their exact face, including bold
 *
 * Run: npm run test:parity
 */
import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import type { TextSpanInfo } from '../src/pdf/engineApi';
import { replaceTextInPage } from '../src/pdf/mupdfEdit';
import { readPageInfo, readTextLines } from '../src/pdf/mupdfPageOps';
import { matInvert, transformRect } from '../src/pdf/mupdfTransforms';

const DEJAVU_SERIF_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf';

/** Single-page PDF with one line in the given font. */
function makePdf(fontArg: string | { name: string; file: string }, subset: boolean): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font =
    typeof fontArg === 'string'
      ? new mupdf.Font(fontArg)
      : new mupdf.Font(fontArg.name, fs.readFileSync(fontArg.file));
  const ref = doc.addSimpleFont(font);
  const res = doc.newDictionary();
  const fonts = doc.newDictionary();
  fonts.put('F1', ref);
  res.put('Font', fonts);
  const content = 'BT /F1 18 Tf 1 0 0 1 72 700 Tm (Original line of text) Tj ET\n';
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, res, content));
  if (subset) doc.subsetFonts();
  const buf = doc.saveToBuffer('compress');
  try {
    return buf.asUint8Array().slice();
  } finally {
    doc.destroy();
  }
}

/** Build the TextSpanInfo the engine facade would produce for line 1 —
 * the same math as MupdfPage.spanAt. */
function spanForFirstLine(pdf: mupdf.PDFDocument): TextSpanInfo {
  const page = pdf.loadPage(0);
  const info = readPageInfo(page);
  const line = readTextLines(page)[0];
  const b = line.bbox;
  const fitzBox: [number, number, number, number] = [b.x, b.y, b.x + b.w, b.y + b.h];
  const pdfBox = transformRect(matInvert(info.pageTransform), fitzBox);
  return {
    page: 1,
    text: line.text,
    bbox: pdfBox,
    fitzBox,
    fontName: line.font.name,
    fontFamily: line.font.family,
    fontWeight: line.font.weight,
    fontStyle: line.font.style,
    fontSize: line.font.size,
  };
}

function edit(bytes: Uint8Array, newText: string) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const pdf = doc.asPDF();
    if (!pdf) throw new Error('not a PDF');
    const span = spanForFirstLine(pdf);
    const result = replaceTextInPage(mupdf, pdf, pdf.loadPage(0), span, newText);
    return { span, ...result };
  } finally {
    doc.destroy();
  }
}

/** Reopen edited bytes and find the replacement line's stext font. */
function editedLineFont(bytes: Uint8Array, needle: string) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const pdf = doc.asPDF();
    const line = readTextLines(pdf!.loadPage(0)).find((l) => l.text.includes(needle));
    expect(line, `edited PDF must contain "${needle}"`).toBeDefined();
    return line!.font;
  } finally {
    doc.destroy();
  }
}

describe('edit font fidelity', () => {
  it('reuses an embedded (unsubsetted) original font program', () => {
    const bytes = makePdf({ name: 'DejaVuSerif-Bold', file: DEJAVU_SERIF_BOLD }, false);
    const { font, bytes: edited } = edit(bytes, 'Replacement words');
    expect(font).toEqual({ strategy: 'embedded', name: 'DejaVuSerif-Bold' });
    const f = editedLineFont(edited, 'Replacement words');
    expect(f.name).toContain('DejaVuSerif-Bold');
    expect(f.family).toBe('serif');
    expect(f.weight).toBe('bold');
  });

  it('falls back to a metric-matched standard-14 face for subsetted programs', () => {
    const bytes = makePdf({ name: 'DejaVuSerif-Bold', file: DEJAVU_SERIF_BOLD }, true);
    const { span, font, bytes: edited } = edit(bytes, 'Replacement words');
    expect(span.fontName).toMatch(/^[A-Z]{6}\+DejaVuSerif-Bold$/);
    // subsetting strips the cmap, so the coverage gate must reject reuse and
    // keep the visual class instead: serif + bold -> Times-Bold
    expect(font).toEqual({ strategy: 'base14', name: 'Times-Bold' });
    const f = editedLineFont(edited, 'Replacement words');
    expect(f.family).toBe('serif');
    expect(f.weight).toBe('bold');
  });

  it('keeps the exact standard-14 face of the original, including bold', () => {
    const bytes = makePdf('Helvetica-Bold', false);
    const { font, bytes: edited } = edit(bytes, 'Replacement words');
    expect(font).toEqual({ strategy: 'base14', name: 'Helvetica-Bold' });
    const f = editedLineFont(edited, 'Replacement words');
    expect(f.family).toBe('sans-serif');
    expect(f.weight).toBe('bold');
  });

  it('reports no font when the edit only deletes text', () => {
    const bytes = makePdf('Helvetica', false);
    const { font } = edit(bytes, '   ');
    expect(font).toBeNull();
  });

  it('is deterministic across repeated runs', () => {
    const bytes = makePdf({ name: 'DejaVuSerif-Bold', file: DEJAVU_SERIF_BOLD }, true);
    const a = edit(bytes, 'Replacement words').font;
    const b = edit(bytes, 'Replacement words').font;
    expect(a).toEqual(b);
  });
});
