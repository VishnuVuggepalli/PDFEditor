/** Node smoke test for mupdf wasm: open, render, structured text, edit, save.
 * Run: node scripts/mupdf-smoke.mjs <path-to-pdf> */
import * as fs from 'node:fs';
import * as mupdf from 'mupdf';

const path = process.argv[2] ?? '../backend/testdata/sample.pdf';
const bytes = fs.readFileSync(path);

const t0 = performance.now();
const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
const t1 = performance.now();
console.log('open ms:', (t1 - t0).toFixed(1));
console.log('pageCount:', doc.countPages());

const pdf = doc.asPDF();
console.log('isPDF:', doc.isPDF(), 'canSaveIncrementally:', pdf?.canBeSavedIncrementally());

const page = doc.loadPage(0);
console.log('bounds:', page.getBounds());

// Render at scale 2
const t2 = performance.now();
const pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
const t3 = performance.now();
console.log('render ms:', (t3 - t2).toFixed(1), 'size:', pix.getWidth(), 'x', pix.getHeight(), 'stride:', pix.getStride(), 'comps:', pix.getNumberOfComponents());
console.log('pixels length:', pix.getPixels().length);
pix.destroy();

// Structured text
const st = page.toStructuredText('preserve-spans');
const json = JSON.parse(st.asJSON());
const firstBlock = json.blocks?.[0];
console.log('stext blocks:', json.blocks?.length);
if (firstBlock?.type === 'text') {
  const line = firstBlock.lines[0];
  console.log('first line text:', JSON.stringify(line.text), 'bbox:', line.bbox, 'font:', line.font);
}
// Search
const hits = st.search('the', 10);
console.log('search "the" hits:', hits.length, hits[0]?.[0]);

// Walk to find a word-level char run
let firstChars = [];
st.walk({
  onChar(c, origin, font, size, quad) {
    if (firstChars.length < 5) firstChars.push({ c, size: size.toFixed(1), font: font.getName() });
  },
});
console.log('first chars:', firstChars);
st.destroy();

// EDIT: redact a rect then stamp replacement text via content stream append
if (pdf) {
  const p0 = pdf.loadPage(0);
  // redact the first line's area
  const annot = p0.createAnnotation('Redact');
  annot.setRect([90, 700, 300, 720]);
  p0.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);

  // append replacement text to the page content stream
  const font = pdf.addSimpleFont(new mupdf.Font('Helvetica'));
  const res = p0.getObject().get('Resources');
  let fonts = res.get('Font');
  if (fonts.isNull()) {
    fonts = pdf.newDictionary();
    res.put('Font', fonts);
  }
  fonts.put('F_mupdf_edit', font);
  const extra = '\nq BT /F_mupdf_edit 12 Tf 1 0 0 1 95 705 Tm (Replaced by mupdf spike) Tj ET Q\n';
  const contents = p0.getObject().get('Contents');
  const orig = contents.readStream();
  const merged = new Uint8Array(orig.getLength() + extra.length);
  merged.set(orig.asUint8Array(), 0);
  merged.set(new TextEncoder().encode(extra), orig.getLength());
  contents.writeStream(merged);

  const out = pdf.saveToBuffer('garbage,compress');
  fs.writeFileSync('/tmp/mupdf-edited.pdf', out.asUint8Array());
  console.log('edited saved:', out.getLength(), 'bytes -> /tmp/mupdf-edited.pdf');

  // verify edit visible in a fresh open
  const doc2 = mupdf.Document.openDocument(fs.readFileSync('/tmp/mupdf-edited.pdf'), 'application/pdf');
  const text2 = doc2.loadPage(0).toStructuredText().asText();
  console.log('edited page contains replacement:', text2.includes('Replaced by mupdf spike'));
}
