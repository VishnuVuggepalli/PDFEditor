/** Drives perf.html in headless Chromium against the dev server on :5299.
 * Run the dev server first: npx vite --port 5299 --strictPort */
import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

function findChromium() {
  try {
    const p = chromium.executablePath();
    if (fs.existsSync(p)) return p;
  } catch {
    /* fall through */
  }
  const cache = path.join(process.env.HOME ?? '/root', '.cache/ms-playwright');
  const dirs = fs
    .readdirSync(cache)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const d of dirs) {
    const p = path.join(cache, d, 'chrome-linux64/chrome');
    if (fs.existsSync(p)) return p;
    const q = path.join(cache, d, 'chrome-linux/chrome');
    if (fs.existsSync(q)) return q;
  }
  throw new Error('no chromium found');
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('console', (m) => console.error('[console]', m.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto('http://localhost:5299/perf.html', { waitUntil: 'load' });
const results = await page.evaluate(() => window.__run);
console.log(JSON.stringify(results, null, 2));
await browser.close();
