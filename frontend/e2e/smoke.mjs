/* End-to-end smoke test of the full user journey against a RUNNING backend.
 *
 * Prereqs: backend on :8800, frontend dev server on BASE_URL (default :5199).
 * Run:     node e2e/smoke.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5199';

// 1x1 red PNG for the image-signature stamp flow.
const SIG_PNG = '/tmp/pdfeditor-e2e-sig.png';
writeFileSync(
  SIG_PNG,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** Assert the saved head PDF contains a FreeText annotation with `text`
 * (uses pdf.js in Node — the canvas paints it in-app, so the DOM can't be
 * asserted directly). */
async function assertFreeTextSaved(docId, text) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const res = await fetch(`${BASE}/api/v1/documents/${encodeURIComponent(docId)}`);
  if (!res.ok) throw new Error(`download head pdf failed: HTTP ${res.status}`);
  const doc = await getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  for (let n = 1; n <= doc.numPages; n++) {
    const anns = await (await doc.getPage(n)).getAnnotations();
    if (anns.some((a) => a.subtype === 'FreeText' && (a.contentsObj?.str ?? '').includes(text))) {
      await doc.destroy();
      return;
    }
  }
  throw new Error(`saved PDF has no FreeText annotation containing "${text}"`);
}
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
  // let the new head version load — store re-init wipes pending edits made
  // during the reload window
  await page.waitForTimeout(1500);

  // 6a. text annotation: place, type, save, reopen, verify persisted
  const docId = decodeURIComponent(page.url().match(/#\/doc\/(.+)$/)[1]);
  await page.click('button[aria-label="Text"]');
  const sheet2 = await page.locator('.pdf-sheet').first().boundingBox();
  await page.mouse.click(sheet2.x + 160, sheet2.y + 220);
  await page.waitForSelector('.an-text-edit');
  await page.keyboard.type('Approved by smoke');
  await page.click('button[aria-label="Select"]'); // blur commits the box
  await page.waitForSelector('.an-text');
  await page.click('.btn.primary:has-text("Save")');
  await page.waitForSelector('text=Saved as v4');
  step('text annotation queued and saved');

  await page.click('.crumb'); // back to library
  await page.waitForSelector('.dropzone');
  await page.locator('.doc-card', { hasText: 'sample.pdf' }).first().click();
  await page.waitForSelector('.pdf-sheet canvas.pdf-canvas');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/03a-text-reopened.png` });
  await assertFreeTextSaved(docId, 'Approved by smoke');
  step('reopened document carries the saved FreeText annotation');

  // 6b. drawn signature: pad → place → save (ink annotation)
  await page.click('button[aria-label="Sign"]');
  const sheet3 = await page.locator('.pdf-sheet').first().boundingBox();
  await page.mouse.click(sheet3.x + 250, sheet3.y + 320);
  await page.waitForSelector('.sig-modal');
  const pad = await page.locator('.sig-draw canvas').boundingBox();
  await page.mouse.move(pad.x + 40, pad.y + 80);
  await page.mouse.down();
  await page.mouse.move(pad.x + 160, pad.y + 50, { steps: 8 });
  await page.mouse.move(pad.x + 280, pad.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.click('.sig-modal .btn.primary:has-text("Place signature")');
  await page.waitForSelector('.an-svg path');
  await page.click('.btn.primary:has-text("Save")');
  await page.waitForSelector('text=Saved as v5');
  step('drawn signature placed as ink annotation and saved');
  await page.waitForTimeout(1500); // head reload settle

  // 6c. image signature: upload → place → save → version list shows stamp
  await page.click('button[aria-label="Sign"]');
  const sheet4 = await page.locator('.pdf-sheet').first().boundingBox();
  await page.mouse.click(sheet4.x + 320, sheet4.y + 420);
  await page.waitForSelector('.sig-modal');
  await page.click('.sig-tabs button:has-text("Image")');
  await page.setInputFiles('.sig-drop input[type=file]', SIG_PNG);
  await page.waitForSelector('.sig-img-preview img');
  await page.click('.sig-modal .btn.primary:has-text("Place signature")');
  await page.waitForSelector('.an-stamp img');
  await page.screenshot({ path: `${SHOTS}/03b-pending-sign.png` });
  await page.click('.btn.primary:has-text("Save")');
  await page.waitForSelector('text=Saved as v6');
  await page.click('.rp-tab:has-text("Versions")');
  await page.waitForSelector('text=signature stamp p1');
  step('image signature stamped; version list shows "signature stamp p1"');

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

  // 11. merge: upload two PDFs, select both, merge into one
  await page.setInputFiles('input[type=file]', FIXTURE);
  await page.locator('.doc-card', { hasText: 'sample.pdf' }).first().waitFor();
  await page.setInputFiles('input[type=file]', FORM_FIXTURE);
  await page.locator('.doc-card', { hasText: 'form.pdf' }).first().waitFor();
  const badge = async (name) => {
    const el = page.locator('.doc-card', { hasText: name }).locator('.dc-pagecount').first();
    await el.waitFor();
    return parseInt(await el.innerText(), 10);
  };
  const expectedPages = (await badge('sample.pdf')) + (await badge('form.pdf'));
  await page.click('.lib-sec button:has-text("Select")');
  await page.locator('.doc-card', { hasText: 'sample.pdf' }).locator('.dc-check').click();
  await page.locator('.doc-card', { hasText: 'form.pdf' }).locator('.dc-check').click();
  await page.click('.select-bar .btn.primary:has-text("Merge 2 documents")');
  await page.waitForSelector('.merge-list .merge-item');
  await page.fill('.merge-name input', 'merged-smoke.pdf');
  await page.screenshot({ path: `${SHOTS}/06-merge-modal.png` });
  await page.locator('.modal .btn.primary', { hasText: 'Merge' }).click();
  await page.waitForSelector('text=Merged 2 documents');
  const mergedPages = await badge('merged-smoke.pdf');
  if (mergedPages !== expectedPages) {
    throw new Error(`merged page count ${mergedPages} != source sum ${expectedPages}`);
  }
  step(`merge created merged-smoke.pdf with ${mergedPages} pages (sum of sources)`);

  // 12. split p1-1 out of the merged document
  await page.locator('.doc-card', { hasText: 'merged-smoke.pdf' }).first().click();
  await page.waitForSelector('.pdf-sheet canvas.pdf-canvas');
  await page.locator('.tb-left button[aria-label="More"]').click();
  await page.locator('.menu .item', { hasText: 'Split' }).click();
  await page.waitForSelector('.split-row');
  await page.fill('.split-row input[name="from"]', '1');
  await page.fill('.split-row input[name="to"]', '1');
  await page.waitForSelector('text=creates 1 document: p1');
  await page.screenshot({ path: `${SHOTS}/07-split-modal.png` });
  await page.locator('.modal .btn.primary', { hasText: 'Split' }).click();
  await page.waitForSelector('text=Split into 1 document');
  await page.waitForSelector('.dropzone'); // navigated back to the library
  await page.locator('.doc-card', { hasText: 'merged-smoke (p1-1).pdf' }).first().waitFor();
  step('split p1-1 created "merged-smoke (p1-1).pdf" in the library');

  // cleanup: remove only the documents created by the merge/split flows
  const created = new Set(['sample.pdf', 'form.pdf', 'merged-smoke.pdf', 'merged-smoke (p1-1).pdf']);
  const listed = await (await fetch(`${BASE}/api/v1/documents`)).json();
  for (const d of listed.data ?? []) {
    if (!created.has(d.name)) continue;
    await fetch(`${BASE}/api/v1/documents/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
  }
  step('merge/split fixtures cleaned up');

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
