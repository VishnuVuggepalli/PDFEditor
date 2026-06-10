/** Verify mupdf coordinate-space assumptions before building the engine. */
import * as fs from 'node:fs';
import * as mupdf from 'mupdf';

const bytes = fs.readFileSync(process.argv[2] ?? '../backend/testdata/sample.pdf');

// 1. getTransform on unrotated page
{
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(0);
  console.log('page transform:', page.getTransform());
  console.log('bounds:', page.getBounds());

  // 2. redact using stext (fitz y-down) coords — does it remove the right text?
  const st = page.toStructuredText();
  const json = JSON.parse(st.asJSON());
  const line = json.blocks[0].lines[0];
  console.log('target line:', JSON.stringify(line.text), 'bbox(fitz):', line.bbox);
  const b = line.bbox;
  const annot = page.createAnnotation('Redact');
  annot.setRect([b.x, b.y, b.x + b.w, b.y + b.h]);
  console.log('annot rect after set:', annot.getRect());
  page.applyRedactions(false, 0, 0, 0);
  const after = page.toStructuredText().asText();
  console.log('line removed by fitz-coords redact:', !after.includes(line.text));
  doc.destroy();
}

// 3. rotated pixmap origin offsets
{
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(0);
  for (const r of [0, 90, 180, 270]) {
    const m = mupdf.Matrix.concat(mupdf.Matrix.scale(0.5, 0.5), mupdf.Matrix.rotate(r));
    const pix = page.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false, true);
    console.log(`rot ${r}: pixmap x=${pix.getX()} y=${pix.getY()} w=${pix.getWidth()} h=${pix.getHeight()}`);
    pix.destroy();
  }
  doc.destroy();
}
