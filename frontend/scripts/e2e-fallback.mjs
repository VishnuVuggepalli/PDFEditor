/** E2E proof of the automatic engine fallback: the mupdf wasm chunk is
 * blocked at the network layer (simulating a wasm/worker init failure), the
 * app must show the one "Falling back to compatibility renderer" toast and
 * still render the document through pdf.js.
 *
 * Prereqs (same as e2e-edit.mjs):
 *   backend:  PORT=8801 DATA_DIR=$(mktemp -d) go run ./cmd/server
 *   frontend: npx vite --config vite.config.e2e.ts --port 5299
 */
import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BACKEND = process.env.E2E_BACKEND ?? 'http://localhost:8801';
const APP = process.env.E2E_APP ?? 'http://localhost:5299';

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

const bytes = fs.readFileSync(new URL('../public/fixtures/sample.pdf', import.meta.url));
const form = new FormData();
form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'fallback.pdf');
const up = await (await fetch(`${BACKEND}/api/v1/documents`, { method: 'POST', body: form })).json();
if (!up.success) throw new Error('upload failed');
const id = up.data.id;
console.log('uploaded doc', id);

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

// Simulate wasm init failure: kill every request for the mupdf wasm binary
// and the worker chunk.
await page.route(/mupdf.*\.(wasm|js|ts)(\?.*)?$/, (route) => {
  const u = route.request().url();
  if (/mupdf-wasm|mupdfWorker|node_modules\/mupdf/.test(u)) {
    console.log('blocked:', u.split('/').slice(-2).join('/'));
    return route.abort();
  }
  return route.continue();
});

await page.goto(`${APP}/#/doc/${id}`);

// 1. one fallback toast
await page.getByText('Falling back to compatibility renderer').waitFor({ timeout: 30000 });
console.log('fallback toast shown');

// 2. the document still renders (pdf.js path)
const canvas = page.locator('.pdf-canvas').first();
await canvas.waitFor({ state: 'visible', timeout: 30000 });
await page.waitForTimeout(1500);
const painted = await canvas.evaluate((c) => {
  const ctx = c.getContext('2d');
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 200 && data[i + 3] > 0) return true; // any dark pixel
  }
  return false;
});
if (!painted) throw new Error('fallback canvas is blank');
console.log('document rendered via pdf.js fallback (canvas has ink)');

// 3. console carries the engine detail
const detail = consoleErrors.find((t) => t.includes('[pdf-engine]'));
console.log('console detail:', detail ? detail.slice(0, 120) : '(none)');
if (!detail) throw new Error('missing [pdf-engine] console detail');

// 4. exactly one toast
const toastCount = await page.getByText('Falling back to compatibility renderer').count();
if (toastCount !== 1) throw new Error(`expected 1 fallback toast, saw ${toastCount}`);

await browser.close();
console.log('FALLBACK E2E PASS');
