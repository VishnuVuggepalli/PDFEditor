/* End-to-end smoke test of the full user journey against a RUNNING backend.
 *
 * Prereqs: backend on :8800, frontend dev server on BASE_URL (default :5199).
 * Run:     node e2e/smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5199';
const FIXTURE = new URL('../../backend/testdata/sample.pdf', import.meta.url).pathname;
const FORM_FIXTURE = new URL('../../backend/testdata/form.pdf', import.meta.url).pathname;
const SHOTS = process.env.SHOT_DIR || '/tmp/pdfeditor-e2e';

const step = (msg) => console.log(`✓ ${msg}`);

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[console.error]', m.text());
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  process.on('uncaughtException', () => {});
  globalThis.__page = page;

  // 1. library loads
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('.dropzone');
  await page.screenshot({ path: `${SHOTS}/01-library.png` });
  step('library renders');

  // 2. upload
  await page.setInputFiles('input[type=file]', FIXTURE);
  await page.waitForSelector('text=Upload complete');
  step('upload completes with toast');
  const card = page.locator('.doc-card', { hasText: 'sample.pdf' }).first();
  await card.waitFor();

  // 3. open editor, canvas renders
  await card.click();
  await page.waitForSelector('.pdf-sheet canvas.pdf-canvas');
  await page.waitForTimeout(800); // let pdf.js paint
  await page.screenshot({ path: `${SHOTS}/02-editor.png` });
  step('editor renders real PDF canvas');

  // 4. rotate page 1 (queued op, save enabled with badge)
  await page.hover('.thumb-item');
  // the rotate-right button is the second action in the hover overlay
  await page.locator('.thumb-item .thumb-actions button.ta').nth(1).click({ force: true });
  await page.waitForSelector('.btn.primary .count');
  step('rotate queued (save badge visible)');

  // 5. highlight drag on the page
  await page.click('button[aria-label="Highlight"]');
  const sheet = page.locator('.pdf-sheet').first();
  const box = await sheet.boundingBox();
  await page.mouse.move(box.x + 90, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 120, { steps: 6 });
  await page.mouse.up();
  await page.waitForSelector('.an-hl');
  await page.screenshot({ path: `${SHOTS}/03-pending.png` });
  step('highlight annotation queued');

  // 6. save → new versions
  await page.click('.btn.primary:has-text("Save")');
  await page.waitForSelector('text=/Saved as v\\d+/');
  step('save posts queue and reports new version');

  // 7. versions tab: view old version read-only, then restore
  await page.click('.rp-tab:has-text("Versions")');
  await page.waitForSelector('.vrow');
  await page.locator('.vrow:not(.head) .vcard').first().hover();
  await page.waitForTimeout(350); // v-acts expand transition
  await page.locator('.v-acts button', { hasText: 'View' }).first().click();
  await page.waitForSelector('.amber-banner');
  await page.screenshot({ path: `${SHOTS}/04-viewing-old.png` });
  step('old version opens read-only with amber banner');
  await page.click('.amber-banner button');

  await page.locator('.vrow:not(.head) .vcard').first().hover();
  await page.waitForTimeout(350);
  await page.locator('.v-acts button', { hasText: 'Restore' }).first().click();
  await page.locator('.modal .btn.primary', { hasText: 'Restore' }).click();
  await page.waitForSelector('text=/Restored v\\d+ as v\\d+/');
  step('restore creates a new head version');

  // 8. rename via breadcrumb
  await page.click('.crumb-file');
  await page.fill('.rename-input', 'smoke-renamed.pdf');
  await page.locator('.modal .btn.primary', { hasText: 'Save' }).click();
  await page.waitForSelector('.crumb-file:has-text("smoke-renamed.pdf")');
  step('rename persists');

  // 9. delete via kebab → back to library
  await page.locator('.tb-left button[aria-label="More"]').click();
  await page.locator('.menu .item.danger', { hasText: 'Delete' }).click();
  await page.locator('.modal .btn.primary', { hasText: 'Delete' }).click();
  await page.waitForSelector('.dropzone');
  await page.waitForSelector('text=Document deleted');
  step('delete removes document and returns to library');

  const gone = await page.locator('.doc-card', { hasText: 'smoke-renamed.pdf' }).count();
  if (gone !== 0) throw new Error('deleted document still listed');
  step('library no longer lists the deleted document');

  // 10. forms: upload a PDF with AcroForm fields, fill, save
  await page.setInputFiles('input[type=file]', FORM_FIXTURE);
  await page.waitForSelector('text=Upload complete');
  const formCard = page.locator('.doc-card', { hasText: 'form.pdf' }).first();
  await formCard.click();
  await page.waitForSelector('.pdf-sheet canvas.pdf-canvas');
  await page.click('.rp-tab:has-text("Forms")');
  const firstField = page.locator('.form-field input[type=text]').first();
  await firstField.waitFor();
  await firstField.fill('Smoke Tester');
  await page.click('.ff-save');
  await page.waitForSelector('text=/Saved form as v\\d+/');
  step('form field saved through the form endpoint');
  await page.screenshot({ path: `${SHOTS}/05-forms.png` });

  // cleanup: delete the form doc
  await page.locator('.tb-left button[aria-label="More"]').click();
  await page.locator('.menu .item.danger', { hasText: 'Delete' }).click();
  await page.locator('.modal .btn.primary', { hasText: 'Delete' }).click();
  await page.waitForSelector('.dropzone');
  step('form document cleaned up');

  await browser.close();
  console.log('\nSMOKE OK');
}

main().catch(async (e) => {
  console.error('SMOKE FAILED:', e);
  try {
    await globalThis.__page?.screenshot({ path: `${SHOTS}/failure.png` });
    console.error(`failure screenshot: ${SHOTS}/failure.png`);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
