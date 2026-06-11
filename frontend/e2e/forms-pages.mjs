/* End-to-end test of the form designer and page insert/append flows
 * against a RUNNING backend + dev server.
 *
 * Covers:
 *   1. add text field (drawn on the page) → save → fill → save →
 *      re-open shows the value
 *   2. insert blank page at position 2 → page count + 1
 *   3. append one page from another stored document → page count + 1
 *
 * Prereqs: backend (e.g. PORT=8804), frontend dev server proxying to it.
 * Run:     BASE_URL=http://localhost:5302 node e2e/forms-pages.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5302';
const FIXTURE = new URL('../../backend/testdata/sample.pdf', import.meta.url).pathname;
const SHOTS = process.env.SHOT_DIR || '/tmp/pdfeditor-e2e-forms';

const step = (msg) => console.log(`✓ ${msg}`);

async function uploadViaApi(name, path) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(path)], { type: 'application/pdf' }), name);
  const res = await fetch(`${BASE}/api/v1/documents`, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.success) throw new Error(`upload ${name} failed: ${JSON.stringify(json)}`);
  return json.data.id;
}

async function pageCountOf(docId) {
  const res = await fetch(`${BASE}/api/v1/documents/${encodeURIComponent(docId)}/meta`);
  const json = await res.json();
  return json.data.pdf.pageCount;
}

async function main() {
  const docId = await uploadViaApi('e2e-forms.pdf', FIXTURE); // 2 pages
  const srcId = await uploadViaApi('e2e-append-src.pdf', FIXTURE); // 2 pages

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  /* ---- 1. form designer: draw a text field, save, fill, re-open ---- */
  await page.goto(`${BASE}/#/doc/${docId}`);
  await page.waitForSelector('.pdf-sheet canvas.pdf-canvas');
  await page.waitForTimeout(800);

  await page.click('.rp-tab:has-text("Forms")');
  await page.click('.ff-add-btns button:has-text("Text field")');
  await page.waitForSelector('.ff-add-hint'); // placement mode hint
  step('forms tab: text-field placement mode armed');

  const sheet = await page.locator('.pdf-sheet').first().boundingBox();
  await page.mouse.move(sheet.x + 120, sheet.y + 200);
  await page.mouse.down();
  await page.mouse.move(sheet.x + 360, sheet.y + 228, { steps: 6 });
  await page.mouse.up();
  await page.waitForSelector('.an-field');
  await page.waitForSelector('.ff-pending-row');
  step('field rect drawn on the page and queued');

  await page.fill('.ff-pending-row input[aria-label="Field name"]', 'e2eApprover');
  await page.screenshot({ path: `${SHOTS}/01-field-queued.png` });
  await page.click('.btn.primary:has-text("Save")');
  await page.waitForSelector('text=/Saved as v\\d+/');
  step('queued field saved as a new version');
  await page.waitForTimeout(1500); // head reload settle

  // the new field appears in the fill UI; fill and save form values
  await page.click('.rp-tab:has-text("Forms")');
  const fieldInput = page.locator('.form-field', { hasText: 'e2eApprover' }).locator('input');
  await fieldInput.waitFor();
  step('created field appears in the fill UI');
  await fieldInput.fill('Vishnu V');
  await page.click('.ff-save:has-text("Save form values")');
  await page.waitForSelector('text=/Saved form as v\\d+/');
  step('form value saved');
  await page.waitForTimeout(1500);

  // re-open from scratch: value persisted
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('.dropzone');
  await page.locator('.doc-card', { hasText: 'e2e-forms.pdf' }).first().click();
  await page.waitForSelector('.pdf-sheet canvas.pdf-canvas');
  await page.click('.rp-tab:has-text("Forms")');
  const reopened = page.locator('.form-field', { hasText: 'e2eApprover' }).locator('input');
  await reopened.waitFor();
  if ((await reopened.inputValue()) !== 'Vishnu V') {
    throw new Error('re-opened document lost the filled value');
  }
  await page.screenshot({ path: `${SHOTS}/02-field-reopened.png` });
  step('re-opened document shows the filled value');

  /* ---- 2. insert blank page at position 2 ---- */
  const before = await pageCountOf(docId);
  // hover the gap above the second thumbnail to reveal its "+" button
  const insertBtn = page.locator('button[aria-label="Insert blank page at position 2"]');
  await page.locator('.psb-insert').nth(1).hover();
  await insertBtn.click({ force: true });
  await page.waitForSelector('text=/Inserted blank page at p2/');
  await page.waitForTimeout(1500);
  const afterInsert = await pageCountOf(docId);
  if (afterInsert !== before + 1) {
    throw new Error(`insert: want ${before + 1} pages, got ${afterInsert}`);
  }
  await page.screenshot({ path: `${SHOTS}/03-inserted.png` });
  step(`blank page inserted at 2 (${before} → ${afterInsert} pages)`);

  /* ---- 3. append one page from another document ---- */
  await page.locator('.psb-head button[aria-label="More"]').click();
  await page.locator('.menu .item', { hasText: 'Append from document' }).click();
  await page.waitForSelector('.append-list');
  await page.locator('.append-doc', { hasText: 'e2e-append-src.pdf' }).click();
  await page.fill('#append-pages-input', '1');
  await page.screenshot({ path: `${SHOTS}/04-append-modal.png` });
  await page.locator('.modal .btn.primary', { hasText: 'Append' }).click();
  await page.waitForSelector('text=/Appended pages/');
  await page.waitForTimeout(1500);
  const afterAppend = await pageCountOf(docId);
  if (afterAppend !== afterInsert + 1) {
    throw new Error(`append: want ${afterInsert + 1} pages, got ${afterAppend}`);
  }
  step(`one page appended from another document (${afterInsert} → ${afterAppend} pages)`);

  // version history carries the new op summaries
  await page.click('.rp-tab:has-text("Versions")');
  await page.waitForSelector('text=insert 1 blank page(s) at p2');
  await page.waitForSelector('text=/append 1 page\\(s\\) from/');
  await page.screenshot({ path: `${SHOTS}/05-versions.png` });
  step('version history lists insert/append op summaries');

  await browser.close();
  console.log('\nALL FORMS/PAGES E2E STEPS PASSED');
}

main().catch(async (e) => {
  console.error('\nE2E FAILED:', e.message);
  try {
    await globalThis.__page?.screenshot({ path: `${SHOTS}/failure.png` });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
