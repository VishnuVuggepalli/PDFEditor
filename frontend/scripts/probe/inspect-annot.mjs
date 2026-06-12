import * as mupdf from 'mupdf';
import { readFileSync } from 'fs';
const doc = mupdf.Document.openDocument(readFileSync('/tmp/styled.pdf'), 'application/pdf');
const page = doc.loadPage(0);
for (const a of page.getAnnotations?.() ?? []) {
  const obj = a.getObject();
  console.log('Subtype:', String(obj.get('Subtype')));
  console.log('DA:', String(obj.get('DA')));
  const bs = obj.get('BS');
  console.log('BS.W:', bs && !bs.isNull() ? String(bs.get('W')) : 'MISSING');
  console.log('Border:', String(obj.get('Border')));
}
// render and check border pixels at rect edge (PDF rect [70,560,300,600], page A4-ish 842 high)
const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
const w = pix.getWidth(), px = pix.getPixels(), n = pix.getNumberOfComponents();
const H = pix.getHeight();
const at = (x, y) => { const o = (y * w + x) * n; return [px[o], px[o+1], px[o+2]]; };
const topY = H - 600; // rect top edge in raster coords
console.log('pixel at rect top edge (185,', topY, '):', at(185, topY), '— white means no border frame');
