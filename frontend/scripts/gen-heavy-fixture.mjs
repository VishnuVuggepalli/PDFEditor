/** Generates public/fixtures/heavy.pdf: a content-dense fixture (3 pages,
 * ~4800 text show ops + ~4000 vector fills per page, flate-compressed) so the
 * perf harness can measure main-thread blocking during render. The trivial
 * sample.pdf renders in single-digit milliseconds and shows nothing. */
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

const PAGES = 3;
const W = 595;
const H = 842;

function pageContent(pageIdx) {
  const ops = [];
  // dense text grid: 80 rows x 30 columns of short tokens
  ops.push('BT /F1 6 Tf');
  for (let row = 0; row < 160; row++) {
    const y = H - 24 - (row % 80) * 10;
    for (let col = 0; col < 30; col++) {
      const x = 20 + col * 19;
      ops.push(`1 0 0 1 ${x} ${y} Tm (p${pageIdx}r${row}c${col}) Tj`);
    }
  }
  ops.push('ET');
  // vector noise: 900 small filled rects in varying grays
  for (let i = 0; i < 4000; i++) {
    const x = (i * 37) % (W - 14);
    const y = (i * 53) % (H - 14);
    const g = ((i % 10) / 10).toFixed(2);
    ops.push(`${g} g ${x} ${y} 12 6 re f`);
  }
  return ops.join('\n');
}

const objects = [];
function addObject(body) {
  objects.push(body);
  return objects.length; // 1-based object number
}

const fontN = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
const pageNums = [];
const kidsPlaceholder = addObject(''); // pages dict, filled later
for (let p = 0; p < PAGES; p++) {
  const raw = Buffer.from(pageContent(p), 'latin1');
  const flate = zlib.deflateSync(raw, { level: 9 });
  const contentN = addObject(
    `<< /Length ${flate.length} /Filter /FlateDecode >>\nstream\n${flate.toString('latin1')}\nendstream`,
  );
  pageNums.push(
    addObject(
      `<< /Type /Page /Parent ${kidsPlaceholder} 0 R /MediaBox [0 0 ${W} ${H}] ` +
        `/Resources << /Font << /F1 ${fontN} 0 R >> >> /Contents ${contentN} 0 R >>`,
    ),
  );
}
objects[kidsPlaceholder - 1] =
  `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${PAGES} >>`;
const catalogN = addObject(`<< /Type /Catalog /Pages ${kidsPlaceholder} 0 R >>`);

let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(out, 'latin1'));
  out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xrefAt = Buffer.byteLength(out, 'latin1');
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i++) {
  out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogN} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

const dest = new URL('../public/fixtures/heavy.pdf', import.meta.url);
fs.writeFileSync(dest, Buffer.from(out, 'latin1'));
console.log('wrote', dest.pathname, Buffer.byteLength(out, 'latin1'), 'bytes');
