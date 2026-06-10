/** End-to-end in-place text edit: upload fixture -> open editor (mupdf
 * engine) -> double-click first text line -> accept prompt -> assert new
 * version stored server-side and replacement text present in head bytes.
 *
 * Prereqs:
 *   backend:  PORT=8801 DATA_DIR=$(mktemp -d) go run ./cmd/server
 *   frontend: VITE_PDF_ENGINE=mupdf npx vite --config vite.config.e2e.ts --port 5299
 */
import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as mupdf from 'mupdf';

const BACKEND = process.env.E2E_BACKEND ?? 'http://localhost:8801';
const APP = process.env.E2E_APP ?? 'http://localhost:5299';
const REPLACEMENT = 'Edited via E2E';

function findChromium() {
  try {
    const p = chromium.executablePath();
    if (fs.existsSync(p)) return p;
  } catch {
    /* fall through */
  }
  const cache = path.join(process.env.HOME ?? '/root', '.cache/ms-playwright');
  for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(cache, d, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('no chromium found');
}

// 1. upload the fixture
const pdfBytes = fs.readFileSync(new URL('../public/fixtures/sample.pdf', import.meta.url));
const form = new FormData();
form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'e2e.pdf');
const up = await fetch(`${BACKEND}/api/v1/documents`, { method: 'POST', body: form });
const upJson = await up.json();
if (!upJson.success) throw new Error('upload failed: ' + JSON.stringify(upJson));
const id = upJson.data.id;
console.log('uploaded doc', id);

// 2. drive the editor
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
page.on('dialog', (d) => {
  console.log('prompt default:', JSON.stringify(d.defaultValue()));
  void d.accept(REPLACEMENT);
});
await page.goto(`${APP}/#/doc/${id}`);
const canvas = page.locator('.pdf-canvas').first();
await canvas.waitFor({ state: 'visible', timeout: 20000 });
// let the first render land
await page.waitForTimeout(1500);

// First fixture line spans fitz x 72..380, y 96..128 on a 595x842 page.
const box = await canvas.boundingBox();
const sx = box.width / 595;
const sy = box.height / 842;
// force: the selectable text-layer span sits above the canvas; the edit
// handler lives on the parent sheet div and receives the bubbled event.
await canvas.dblclick({ position: { x: 226 * sx, y: 112 * sy }, force: true });

// 3. wait for the success toast
await page.getByText(/Text edit saved as v2/).waitFor({ timeout: 20000 });
console.log('toast: Text edit saved as v2');
await browser.close();

// 4. verify server state
const meta = await (await fetch(`${BACKEND}/api/v1/documents/${id}/meta`)).json();
const doc = meta.data.document;
const last = doc.versions[doc.versions.length - 1];
console.log('headVersion:', doc.headVersion, 'ops:', last.ops);
if (doc.headVersion !== 2 || last.ops !== 'content edit') throw new Error('version state wrong');

const head = new Uint8Array(await (await fetch(`${BACKEND}/api/v1/documents/${id}`)).arrayBuffer());
const reopened = mupdf.Document.openDocument(head, 'application/pdf');
const text = reopened.loadPage(0).toStructuredText().asText();
console.log('replacement visible in head bytes:', text.includes(REPLACEMENT));
console.log('original line removed:', !text.includes('PDFEditor test fixture page 1'));
if (!text.includes(REPLACEMENT)) throw new Error('replacement missing from saved PDF');
console.log('E2E PASS');
