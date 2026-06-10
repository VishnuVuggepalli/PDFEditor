/** Generates public/fixtures/image.pdf: one 595x842 page with a text line
 * and a red 40x30 PNG image painted at the PDF rect [100,500,300,650]
 * (fitz display box [100,192,300,342]) — the image-edit E2E selects it by
 * clicking that region. Built with mupdf itself so the embedded image is a
 * real XObject the engine locates via the preserve-images stext walk. */
import * as fs from 'node:fs';
import * as mupdf from 'mupdf';

const W = 595;
const H = 842;

// red 40x30 PNG via Pixmap
const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 30], false);
pix.clear(255);
const px = pix.getPixels();
for (let i = 0; i < px.length; i += 3) {
  px[i] = 200;
  px[i + 1] = 30;
  px[i + 2] = 40;
}
const png = pix.asPNG();
pix.destroy();

const doc = new mupdf.PDFDocument();
const imgRef = doc.addImage(new mupdf.Image(png));
const fontRef = doc.addSimpleFont(new mupdf.Font('Helvetica'));
const contents = [
  'q 200 0 0 150 100 500 cm /Im0 Do Q',
  'BT /F1 18 Tf 1 0 0 1 72 730 Tm (PDFEditor image fixture) Tj ET',
].join('\n');
const pageRef = doc.addPage(
  [0, 0, W, H],
  0,
  { XObject: { Im0: imgRef }, Font: { F1: fontRef } },
  contents,
);
doc.insertPage(-1, pageRef);

const out = new URL('../public/fixtures/image.pdf', import.meta.url);
fs.writeFileSync(out, doc.saveToBuffer('compress').asUint8Array());
console.log('wrote', out.pathname);
