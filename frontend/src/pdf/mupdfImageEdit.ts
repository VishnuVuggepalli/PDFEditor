/** In-place image edits against the live PDFDocument (mirrors mupdfEdit.ts
 * for text). Locating images uses the structured-text walk with
 * 'preserve-images': onImageBlock reports each paint's bbox + full CTM in
 * fitz display space plus the decoded Image object (verified against the
 * 1.27 typings and runtime — there is no page.getImages() in these
 * bindings; the walk is the supported route).
 *
 * Edit strategy: remove the original paint with a Redact annotation over
 * its bbox (REDACT_IMAGE_REMOVE, text and line art untouched), then — for
 * replace/transform — register the image XObject in the page resources and
 * append a content stream painting it into the target rect. Known limit:
 * redaction removes any image paint touching the region, so fully
 * overlapping images are edited together. */

import type * as MU from 'mupdf';
import type { ImageEditSpec, PageImageInfo } from './mupdfProtocol';
import type { Mat } from './mupdfTransforms';
import { buildImageContentStream, fitRectWithin } from './imageEdit';

type Mupdf = typeof MU;

/** Locate every image paint on the page, in paint order. */
export function readPageImages(page: MU.PDFPage): PageImageInfo[] {
  const out: PageImageInfo[] = [];
  const st = page.toStructuredText('preserve-images');
  try {
    st.walk({
      onImageBlock(bbox, transform, image) {
        out.push({
          index: out.length,
          fitzBox: [bbox[0], bbox[1], bbox[2], bbox[3]],
          transform: transform as Mat,
          width: image.getWidth(),
          height: image.getHeight(),
        });
      },
    });
  } finally {
    st.destroy();
  }
  return out;
}

interface LocatedImage {
  fitzBox: [number, number, number, number];
  /** decoded image object; stays valid after the stext page is destroyed */
  image: MU.Image;
}

/** Re-walk the page and grab the index-th image paint (selection happened
 * on the main thread against the same paint order). */
function grabImage(page: MU.PDFPage, index: number): LocatedImage | null {
  let found: LocatedImage | null = null;
  let i = 0;
  const st = page.toStructuredText('preserve-images');
  try {
    st.walk({
      onImageBlock(bbox, _transform, image) {
        if (i === index) found = { fitzBox: [bbox[0], bbox[1], bbox[2], bbox[3]], image };
        i += 1;
      },
    });
  } finally {
    st.destroy();
  }
  return found;
}

/** Register an image XObject in the page resources under a fresh name. */
export function registerImageResource(
  doc: MU.PDFDocument,
  pageObj: MU.PDFObject,
  ref: MU.PDFObject,
): string {
  let res = pageObj.get('Resources');
  if (!res.isDictionary()) {
    res = doc.newDictionary();
    pageObj.put('Resources', res);
  }
  let xobjs = res.get('XObject');
  if (!xobjs.isDictionary()) {
    xobjs = doc.newDictionary();
    res.put('XObject', xobjs);
  }
  let name = 'FzImg';
  for (let i = 0; !xobjs.get(name).isNull(); i++) name = `FzImg${i}`;
  xobjs.put(name, ref);
  return name;
}

/** Append a content-stream fragment after the existing page contents (same
 * pattern as the text edit: Contents becomes [original, extra]). */
function appendPageContent(doc: MU.PDFDocument, pageObj: MU.PDFObject, fragment: string): void {
  const extra = doc.addStream(fragment, {});
  const contents = pageObj.get('Contents');
  if (contents.isArray()) {
    contents.push(extra);
  } else {
    const arr = doc.newArray();
    arr.push(contents);
    arr.push(extra);
    pageObj.put('Contents', arr);
  }
}

/** Apply one image edit (delete / replace / move-resize) and return the
 * complete edited PDF bytes. */
export function applyImageEdit(
  mu: Mupdf,
  doc: MU.PDFDocument,
  page: MU.PDFPage,
  edit: ImageEditSpec,
): Uint8Array {
  const located = grabImage(page, edit.index);
  if (!located) throw new Error(`image ${edit.index} not found on page`);

  // 1. Remove the original paint: redact its region, images only.
  const annot = page.createAnnotation('Redact');
  annot.setRect(located.fitzBox);
  page.applyRedactions(
    false,
    mu.PDFPage.REDACT_IMAGE_REMOVE,
    mu.PDFPage.REDACT_LINE_ART_NONE,
    mu.PDFPage.REDACT_TEXT_NONE,
  );

  // 2. Paint the replacement (replace) or the original image (transform).
  if (edit.kind !== 'delete') {
    const pageObj = page.getObject();
    let image: MU.Image;
    let rect: [number, number, number, number];
    if (edit.kind === 'replace') {
      image = new mu.Image(new Uint8Array(edit.bytes));
      rect = fitRectWithin(image.getWidth(), image.getHeight(), edit.rect);
    } else {
      image = located.image;
      rect = edit.rect;
    }
    const name = registerImageResource(doc, pageObj, doc.addImage(image));
    appendPageContent(doc, pageObj, buildImageContentStream(name, rect));
  }

  const buf = doc.saveToBuffer('garbage,compress');
  try {
    return buf.asUint8Array().slice();
  } finally {
    buf.destroy();
  }
}
