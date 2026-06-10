/** End-to-end in-place text edit (worker engine + inline overlay):
 *  1. upload fixture -> open editor (mupdf engine) -> double-click first
 *     text line -> overlay prefilled -> type replacement -> Enter ->
 *     new version stored server-side, replacement present in head bytes.
 *  2. Escape cancels the overlay without creating a version.
 *  3. responsiveness: open a content-heavy doc and assert the main thread
 *     never blocks > 200ms while the pages render (heartbeat probe; the
 *     longtask PerformanceObserver is not delivered in headless Chromium).
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

await browser.close();
console.log('E2E PASS');
