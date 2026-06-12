// Probe: how does the bundled mupdf render FreeText borders/background
// across /BS, /Border, /C, /DA variants when no /AP exists?
import * as mupdf from 'mupdf';

function pdfWith(annotExtra) {
  return `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >> endobj
4 0 obj << /Type /Annot /Subtype /FreeText /Rect [50 50 150 100]
  /Contents (hello) /DA (/Helvetica 12 Tf 0 0 1 rg) ${annotExtra} >> endobj
trailer << /Root 1 0 R >>`;
}

const variants = [
  ['baseline: nothing', ''],
  ['BS W0', '/BS << /W 0 /S /S >>'],
  ['BS W2, no C', '/BS << /W 2 /S /S >>'],
  ['BS W2 + C red', '/BS << /W 2 /S /S >> /C [1 0 0]'],
  ['C green only (no BS)', '/C [0 1 0]'],
  ['BS W0 + C red', '/BS << /W 0 /S /S >> /C [1 0 0]'],
];

for (const [name, extra] of variants) {
  const doc = mupdf.Document.openDocument(Buffer.from(pdfWith(extra)), 'application/pdf');
  const page = doc.loadPage(0);
  if (page.update) page.update();
  const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  const w = pix.getWidth(), px = pix.getPixels(), n = pix.getNumberOfComponents();
  const at = (x, y) => { const o = (y * w + x) * n; return [px[o], px[o+1], px[o+2]]; };
  // border edge: rect edge at y=200-100=100 flips (PDF y-up vs raster y-down): rect [50,50,150,100] -> raster y in [100,150]
  const edge = at(100, 100);   // top border midpoint
  const inside = at(100, 125); // interior
  const outside = at(100, 90); // just outside
  console.log(`${name.padEnd(24)} edge=${edge} inside=${inside} outside=${outside}`);
  doc.destroy();
}
