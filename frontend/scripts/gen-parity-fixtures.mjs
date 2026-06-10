/** Generate the engine-parity fixture corpus into parity/fixtures/.
 *
 * Fixtures are deterministic (no timestamps, fixed IDs where possible) and
 * committed to the repo; re-run this script only when the corpus changes.
 * CJK pages embed Droid Sans Fallback (Apache-2.0, ships with Debian) and
 * are then font-subset via ghostscript to keep the file small.
 *
 * Run: node scripts/gen-parity-fixtures.mjs
 */
import * as mupdf from 'mupdf';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUT = new URL('../parity/fixtures/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const CJK_FONT = '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf';

/** Escape a PDF literal string. */
function esc(s) {
  return s.replace(/([\\()])/g, '\\$1');
}

/** Glyph-ID hex string for an Identity-H Type0 font (doc.addFont embeds the
 * program and emits a ToUnicode CMap, so extraction still yields Unicode). */
function gidHex(font, s) {
  let out = '';
  for (const ch of s) {
    out += font.encodeCharacter(ch.codePointAt(0)).toString(16).padStart(4, '0');
  }
  return `<${out}>`;
}

/**
 * Build one PDF.
 * @param pages Array of {
 *   mediaBox: [x0,y0,x1,y1], rotate?: number, cropBox?: [x0,y0,x1,y1],
 *   lines: Array<{x, y, size?, text, font?: 'F1'|'CJK'}>,
 * }
 * @param withCjk register the CJK font in resources
 */
function buildPdf(pages, withCjk = false) {
  const doc = new mupdf.PDFDocument();
  const helv = doc.addSimpleFont(new mupdf.Font('Helvetica'));
  const times = doc.addSimpleFont(new mupdf.Font('Times-Roman'));
  let cjk = null;
  let cjkFont = null;
  if (withCjk) {
    const data = fs.readFileSync(CJK_FONT);
    cjkFont = new mupdf.Font('DroidSansFallback', data);
    // addFont (NOT addCJKFont): addCJKFont only references mupdf's builtin
    // CJK fonts by name without embedding — pdf.js then has nothing to
    // rasterize. addFont embeds the program with Identity-H + ToUnicode.
    cjk = doc.addFont(cjkFont);
  }
  for (const p of pages) {
    const res = doc.newDictionary();
    const fonts = doc.newDictionary();
    fonts.put('F1', helv);
    fonts.put('F2', times);
    if (cjk) fonts.put('CJK', cjk);
    res.put('Font', fonts);
    let content = '';
    for (const l of p.lines) {
      const size = l.size ?? 12;
      const fname = l.font ?? 'F1';
      const payload = fname === 'CJK' ? gidHex(cjkFont, l.text) : `(${esc(l.text)})`;
      content += `BT /${fname} ${size} Tf 1 0 0 1 ${l.x} ${l.y} Tm ${payload} Tj ET\n`;
    }
    const pageObj = doc.addPage(p.mediaBox, p.rotate ?? 0, res, content);
    if (p.cropBox) {
      const arr = doc.newArray();
      for (const v of p.cropBox) arr.push(v);
      pageObj.put('CropBox', arr);
    }
    doc.insertPage(-1, pageObj);
  }
  // Trim embedded fonts (Droid Sans Fallback is ~4.5 MB unsubsetted) while
  // keeping the encoding + ToUnicode mapping intact for text extraction.
  if (withCjk) doc.subsetFonts();
  const buf = doc.saveToBuffer('garbage,compress');
  const bytes = buf.asUint8Array().slice();
  buf.destroy();
  doc.destroy();
  return bytes;
}

function write(name, bytes) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}

/** Dense column of numbered lines. */
function column(x, yTop, count, size, leading, label) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push({
      x,
      y: yTop - i * leading,
      size,
      text: `${label} line ${String(i + 1).padStart(2, '0')} lorem ipsum dolor sit amet consectetur`,
      font: 'F2',
    });
  }
  return lines;
}

const A4 = [0, 0, 595, 842];

/* ---- rotate90 / rotate270: intrinsic /Rotate pages ---- */
for (const deg of [90, 270]) {
  write(
    `rotate${deg}.pdf`,
    buildPdf([
      {
        mediaBox: A4,
        rotate: deg,
        lines: [
          { x: 72, y: 760, size: 24, text: `Rotated ${deg} landscape heading` },
          { x: 72, y: 700, text: 'The quick brown fox jumps over the lazy dog.' },
          { x: 72, y: 670, text: 'Quadrant marker northwest anchored at left margin.' },
          { x: 320, y: 120, text: 'Quadrant marker southeast near page corner.' },
        ],
      },
      {
        mediaBox: A4,
        lines: [
          { x: 72, y: 760, size: 18, text: 'Second page upright portrait control.' },
          { x: 72, y: 700, text: 'Searchable term zebra appears only on page two.' },
        ],
      },
    ]),
  );
}

/* ---- cropbox: nonzero CropBox origin ---- */
write(
  'cropbox.pdf',
  buildPdf([
    {
      mediaBox: [0, 0, 700, 900],
      cropBox: [120, 160, 520, 760],
      lines: [
        { x: 140, y: 720, size: 20, text: 'Cropped page with offset origin' },
        { x: 140, y: 660, text: 'Visible text inside the crop window.' },
        { x: 140, y: 200, text: 'Bottom marker inside crop region.' },
        // outside the CropBox: must NOT render but extractors may still see it
        { x: 10, y: 880, text: 'OFFCROP hidden text outside the crop box.' },
      ],
    },
    {
      mediaBox: [0, 0, 700, 900],
      cropBox: [120, 160, 520, 760],
      lines: [
        { x: 140, y: 720, size: 18, text: 'Second cropped page.' },
        { x: 140, y: 660, text: 'Searchable term walrus appears only on page two.' },
      ],
    },
  ]),
);

/* ---- cjk: Chinese + Japanese text via embedded Droid Sans Fallback ---- */
{
  const bytes = buildPdf(
    [
      {
        mediaBox: A4,
        lines: [
          { x: 72, y: 760, size: 22, text: '中文测试文档', font: 'CJK' },
          { x: 72, y: 700, size: 14, text: '你好世界，这是一个测试页面。', font: 'CJK' },
          { x: 72, y: 660, size: 14, text: '日本語のテキストもあります。', font: 'CJK' },
          { x: 72, y: 620, text: 'Mixed Latin line for anchor.' },
        ],
      },
      {
        mediaBox: A4,
        lines: [
          { x: 72, y: 760, size: 16, text: '第二页只有这一行。', font: 'CJK' },
          { x: 72, y: 700, text: 'Latin control line page two.' },
        ],
      },
    ],
    true,
  );
  write('cjk.pdf', bytes);
}

/* ---- multicol: dense three-column page ---- */
write(
  'multicol.pdf',
  buildPdf([
    {
      mediaBox: A4,
      lines: [
        { x: 72, y: 800, size: 16, text: 'Three column layout stress page' },
        ...column(40, 770, 60, 7, 12, 'alpha'),
        ...column(225, 770, 60, 7, 12, 'beta'),
        ...column(410, 770, 60, 7, 12, 'gamma'),
      ],
    },
    {
      mediaBox: A4,
      lines: [
        { x: 72, y: 760, text: 'Sparse second page; term quokka only here.' },
      ],
    },
  ]),
);

/* ---- a0: large page (A0 = 2384 x 3370 pt) ---- */
write(
  'a0.pdf',
  buildPdf([
    {
      mediaBox: [0, 0, 2384, 3370],
      lines: [
        { x: 150, y: 3150, size: 96, text: 'A0 poster heading' },
        { x: 150, y: 2950, size: 40, text: 'Large format page for scale stress testing.' },
        ...column(150, 2700, 40, 18, 40, 'poster'),
        { x: 1800, y: 200, size: 24, text: 'Far corner marker.' },
      ],
    },
    {
      mediaBox: [0, 0, 2384, 3370],
      lines: [{ x: 150, y: 3150, size: 48, text: 'A0 second page, term ibex only here.' }],
    },
  ]),
);

console.log('done ->', OUT);
