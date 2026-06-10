/** End-to-end in-place text edit (worker engine + inline overlay):
 *  1. upload fixture -> open editor (mupdf engine) -> double-click first
 *     text line -> overlay prefilled -> type replacement -> Enter ->
 *     new version stored server-side, replacement present in head bytes.
 *  2. Escape cancels the overlay without creating a version.
 *  3. responsiveness: open a content-heavy doc and assert the main thread
 *     never blocks > 200ms while the pages render (heartbeat probe; the
 *     longtask PerformanceObserver is not delivered in headless Chromium).
 *  4. in-place image edit: open the image fixture -> Select-tool click the
 *     embedded image -> Replace with a generated JPEG -> new version whose
 *     head bytes embed the JPEG verbatim (DCT passthrough byte search) ->
 *     select again -> Delete -> next version has no images, text intact.
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
const MAX_BLOCK_MS = 200;

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

async function upload(fixture, name) {
  const bytes = fs.readFileSync(new URL(`../public/fixtures/${fixture}`, import.meta.url));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
  const up = await fetch(`${BACKEND}/api/v1/documents`, { method: 'POST', body: form });
  const json = await up.json();
  if (!json.success) throw new Error('upload failed: ' + JSON.stringify(json));
  return json.data.id;
}

const id = await upload('sample.pdf', 'e2e.pdf');
console.log('uploaded doc', id);

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
// Main-thread responsiveness probe: gaps between MessageChannel ticks.
await page.addInitScript(() => {
  window.__blocks = [];
  const chan = new MessageChannel();
  let last = performance.now();
  chan.port1.onmessage = () => {
    const now = performance.now();
    if (now - last > 50) window.__blocks.push(Math.round(now - last));
    last = now;
    chan.port2.postMessage(0);
  };
  chan.port2.postMessage(0);
});

/* ---- 1. inline edit flow ---- */
await page.goto(`${APP}/#/doc/${id}`);
const canvas = page.locator('.pdf-canvas').first();
await canvas.waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(1500); // let the first render land

// First fixture line spans fitz x 72..380, y 96..128 on a 595x842 page.
const box = await canvas.boundingBox();
const sx = box.width / 595;
const sy = box.height / 842;
// force: the selectable text-layer span sits above the canvas; the edit
// handler lives on the parent sheet div and receives the bubbled event.
await canvas.dblclick({ position: { x: 226 * sx, y: 112 * sy }, force: true });

const input = page.locator('.inline-edit .ie-input');
await input.waitFor({ state: 'visible', timeout: 10000 });
const prefilled = await input.textContent();
console.log('overlay prefilled:', JSON.stringify(prefilled));
if (!prefilled || !prefilled.includes('PDFEditor test fixture')) {
  throw new Error('overlay not prefilled with the line text');
}

await input.press('ControlOrMeta+a');
await input.pressSequentially(REPLACEMENT);
await input.press('Enter');

await page.getByText(/Text edit saved as v2/).waitFor({ timeout: 20000 });
console.log('toast: Text edit saved as v2');
await page.locator('.inline-edit').waitFor({ state: 'detached', timeout: 10000 });
console.log('overlay closed after commit');

/* ---- 2. Escape cancels without a new version ---- */
await page.waitForTimeout(1500); // reloaded head version renders
await canvas.dblclick({ position: { x: 226 * sx, y: 112 * sy }, force: true });
await input.waitFor({ state: 'visible', timeout: 10000 });
await input.pressSequentially('discard me');
await input.press('Escape');
await page.locator('.inline-edit').waitFor({ state: 'detached', timeout: 5000 });
console.log('overlay closed on Escape');

/* ---- verify server state ---- */
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
if (text.includes('discard me')) throw new Error('escaped edit leaked into the PDF');

/* ---- font fidelity: the edited line keeps the original's font class ----
 * The fixture line is Helvetica/sans-serif/normal; the deterministic
 * strategy must keep that exact standard-14 face for the replacement. */
{
  const st = reopened.loadPage(0).toStructuredText('preserve-spans');
  const lines = JSON.parse(st.asJSON())
    .blocks.filter((b) => b.type === 'text')
    .flatMap((b) => b.lines);
  const edited = lines.find((l) => l.text.includes(REPLACEMENT));
  if (!edited) throw new Error('edited line not found in structured text');
  console.log('edited line font:', JSON.stringify(edited.font));
  if (edited.font.name !== 'Helvetica' || edited.font.family !== 'sans-serif') {
    throw new Error(
      `edited line font ${edited.font.name}/${edited.font.family} does not match the original Helvetica/sans-serif`,
    );
  }
  st.destroy();
}

/* ---- 3. responsiveness while rendering a heavy document ---- */
const heavyId = await upload('heavy.pdf', 'e2e-heavy.pdf');
console.log('uploaded heavy doc', heavyId);
const heavyPage = await browser.newPage();
heavyPage.on('pageerror', (e) => console.error('[pageerror]', e.message));
await heavyPage.addInitScript(() => {
  window.__blocks = [];
  const chan = new MessageChannel();
  let last = performance.now();
  chan.port1.onmessage = () => {
    const now = performance.now();
    if (now - last > 50) window.__blocks.push(Math.round(now - last));
    last = now;
    chan.port2.postMessage(0);
  };
  chan.port2.postMessage(0);
});
await heavyPage.goto(`${APP}/#/doc/${heavyId}`);
await heavyPage.locator('.pdf-canvas').nth(2).waitFor({ state: 'visible', timeout: 30000 });
await heavyPage.waitForTimeout(2500); // all three pages render + text layers
const blocks = await heavyPage.evaluate(() => window.__blocks);
console.log('main-thread blocks >50ms during heavy render:', JSON.stringify(blocks));
const worst = blocks.length ? Math.max(...blocks) : 0;
if (worst > MAX_BLOCK_MS) {
  throw new Error(`main thread blocked ${worst}ms (> ${MAX_BLOCK_MS}ms) during render`);
}
console.log(`UI stayed responsive (worst block ${worst}ms <= ${MAX_BLOCK_MS}ms)`);

/* ---- 4. in-place image edit (Select tool, mupdf engine) ---- */
const imgDocId = await upload('image.pdf', 'e2e-image.pdf');
console.log('uploaded image doc', imgDocId);

// Replacement: a green 64x48 JPEG generated in-process. mupdf embeds JPEG
// data verbatim (DCTDecode passthrough), so the saved head bytes must
// contain this exact buffer after the replace.
const jpegBytes = (() => {
  const p = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 64, 48], false);
  p.clear(255);
  const data = p.getPixels();
  for (let i = 0; i < data.length; i += 3) {
    data[i] = 10;
    data[i + 1] = 180;
    data[i + 2] = 60;
  }
  const jpg = p.asJPEG(85, false);
  p.destroy();
  return Buffer.from(jpg);
})();

async function fetchHead(id) {
  return new Uint8Array(await (await fetch(`${BACKEND}/api/v1/documents/${id}`)).arrayBuffer());
}

function walkImages(bytes) {
  const d = mupdf.Document.openDocument(bytes, 'application/pdf');
  const st = d.loadPage(0).toStructuredText('preserve-images');
  const found = [];
  st.walk({
    onImageBlock(bbox, transform, image) {
      found.push({ bbox, w: image.getWidth(), h: image.getHeight() });
    },
  });
  const text = st.asText();
  st.destroy();
  d.destroy();
  return { found, text };
}

// the freshly uploaded v1 must not contain the replacement JPEG yet
if (Buffer.from(await fetchHead(imgDocId)).includes(jpegBytes)) {
  throw new Error('v1 unexpectedly already contains the replacement JPEG bytes');
}

const imgPage = await browser.newPage();
imgPage.on('pageerror', (e) => console.error('[pageerror]', e.message));
await imgPage.goto(`${APP}/#/doc/${imgDocId}`);
const imgCanvas = imgPage.locator('.pdf-canvas').first();
await imgCanvas.waitFor({ state: 'visible', timeout: 20000 });
await imgPage.waitForTimeout(1500); // first render lands

// Fixture image: fitz box [100,192,300,342] on a 595x842 page.
const ibox = await imgCanvas.boundingBox();
const isx = ibox.width / 595;
const isy = ibox.height / 842;
await imgCanvas.click({ position: { x: 200 * isx, y: 267 * isy }, force: true });

const overlay = imgPage.locator('.image-edit');
await overlay.waitFor({ state: 'visible', timeout: 10000 });
console.log('image selected: overlay + toolbar visible');

/* replace via the hidden file input */
await imgPage.locator('.image-edit input[type=file]').setInputFiles({
  name: 'replacement.jpg',
  mimeType: 'image/jpeg',
  buffer: jpegBytes,
});
await imgPage.getByText(/Image edit saved as v2/).waitFor({ timeout: 20000 });
console.log('toast: Image edit saved as v2');
await overlay.waitFor({ state: 'detached', timeout: 10000 });

const imgMeta1 = await (await fetch(`${BACKEND}/api/v1/documents/${imgDocId}/meta`)).json();
const imgDoc1 = imgMeta1.data.document;
const lastV2 = imgDoc1.versions[imgDoc1.versions.length - 1];
console.log('headVersion:', imgDoc1.headVersion, 'ops:', lastV2.ops);
if (imgDoc1.headVersion !== 2 || lastV2.ops !== 'content edit') {
  throw new Error('image replace version state wrong');
}

const headV2 = await fetchHead(imgDocId);
if (!Buffer.from(headV2).includes(jpegBytes)) {
  throw new Error('replacement JPEG bytes missing from saved PDF (byte search)');
}
console.log('head bytes contain the replacement JPEG verbatim');
const afterReplace = walkImages(headV2);
console.log('images after replace:', JSON.stringify(afterReplace.found));
if (afterReplace.found.length !== 1) throw new Error('expected exactly one image after replace');
if (afterReplace.found[0].w !== 64 || afterReplace.found[0].h !== 48) {
  throw new Error('replacement image dimensions wrong');
}
// 64x48 (4:3) aspect-fits the 200x150 (4:3) target exactly: fitz [100,192,300,342]
const rb = afterReplace.found[0].bbox;
if (Math.abs(rb[0] - 100) > 1 || Math.abs(rb[1] - 192) > 1 || Math.abs(rb[2] - 300) > 1 || Math.abs(rb[3] - 342) > 1) {
  throw new Error(`replacement painted at wrong rect: ${JSON.stringify(rb)}`);
}
if (!afterReplace.text.includes('PDFEditor image fixture')) {
  throw new Error('image replace destroyed the page text');
}

/* delete the (replaced) image */
await imgPage.waitForTimeout(1500); // reloaded head version renders
await imgCanvas.click({ position: { x: 200 * isx, y: 267 * isy }, force: true });
await overlay.waitFor({ state: 'visible', timeout: 10000 });
await imgPage.getByTitle('Delete image').click();
await imgPage.getByText(/Image edit saved as v3/).waitFor({ timeout: 20000 });
console.log('toast: Image edit saved as v3');

const headV3 = await fetchHead(imgDocId);
const afterDelete = walkImages(headV3);
console.log('images after delete:', afterDelete.found.length, 'text kept:', afterDelete.text.includes('PDFEditor image fixture'));
if (afterDelete.found.length !== 0) throw new Error('image still present after delete');
if (!afterDelete.text.includes('PDFEditor image fixture')) {
  throw new Error('image delete destroyed the page text');
}

await browser.close();
console.log('E2E PASS');
