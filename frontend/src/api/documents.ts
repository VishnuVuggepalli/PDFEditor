/** Typed endpoint functions for the document API. */

import { API_BASE, ApiError, request, requestBytes, requestJSON, unwrap } from './client';
import { emitToast } from './toastBus';
import type {
  AnnotationInput,
  DocumentMeta,
  DocumentRecord,
  FormField,
  NewFormFieldInput,
  PageOp,
  SplitRange,
  Version,
} from '../types/document';

export function listDocuments(): Promise<DocumentRecord[]> {
  return request<DocumentRecord[]>('/documents');
}

export function getMeta(id: string): Promise<DocumentMeta> {
  return request<DocumentMeta>(`/documents/${encodeURIComponent(id)}/meta`);
}

export function listVersions(id: string): Promise<Version[]> {
  return request<Version[]>(`/documents/${encodeURIComponent(id)}/versions`);
}

export function renameDocument(id: string, name: string): Promise<DocumentRecord> {
  return requestJSON<DocumentRecord>(`/documents/${encodeURIComponent(id)}`, 'PATCH', { name });
}

export function deleteDocument(id: string): Promise<{ deleted: string }> {
  return request<{ deleted: string }>(`/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Delete one version from the history. The server rejects deleting v1 (the
 * original), the head version, and the only remaining version. */
export function deleteVersion(id: string, n: number): Promise<DocumentRecord> {
  return request<DocumentRecord>(`/documents/${encodeURIComponent(id)}/versions/${n}`, {
    method: 'DELETE',
  });
}

export function restoreVersion(id: string, n: number): Promise<DocumentRecord> {
  return request<DocumentRecord>(
    `/documents/${encodeURIComponent(id)}/versions/${n}/restore`,
    { method: 'POST' },
  );
}

export function applyPageOps(id: string, ops: PageOp[]): Promise<DocumentRecord> {
  return requestJSON<DocumentRecord>(`/documents/${encodeURIComponent(id)}/pages/ops`, 'POST', {
    ops,
  });
}

export function addAnnotations(
  id: string,
  annotations: AnnotationInput[],
): Promise<DocumentRecord> {
  return requestJSON<DocumentRecord>(
    `/documents/${encodeURIComponent(id)}/annotations`,
    'POST',
    { annotations },
  );
}

/** Place a visual signature image (PNG/JPEG, ≤5 MB) on one page; the server
 * fits it into rect (PDF points, lower-left origin) and creates a new
 * version. Wire format: multipart form { image, page, rect: JSON array }. */
export function stampSignature(
  id: string,
  page: number,
  rect: readonly [number, number, number, number],
  image: Blob,
): Promise<DocumentRecord> {
  const form = new FormData();
  form.append('image', image, 'signature');
  form.append('page', String(page));
  form.append('rect', JSON.stringify(rect));
  return request<DocumentRecord>(`/documents/${encodeURIComponent(id)}/stamp`, {
    method: 'POST',
    body: form,
  });
}

/** Combine 2+ documents (head versions, in order) into one new document. */
export function mergeDocuments(ids: string[], name: string): Promise<DocumentRecord> {
  return requestJSON<DocumentRecord>('/documents/merge', 'POST', { ids, name });
}

/** Extract page ranges of the head version into new documents; the source
 * document is left untouched. Returns the created documents (one per range). */
export function splitDocument(id: string, ranges: SplitRange[]): Promise<DocumentRecord[]> {
  return requestJSON<DocumentRecord[]>(`/documents/${encodeURIComponent(id)}/split`, 'POST', {
    ranges,
  });
}

/** Upload a complete client-edited PDF (mupdf in-place text edit) as a new
 * version. Wire format: multipart form { pdf }; ops summary "content edit". */
export function replaceContent(id: string, pdf: Uint8Array): Promise<DocumentRecord> {
  const form = new FormData();
  form.append('pdf', new Blob([pdf as BlobPart], { type: 'application/pdf' }), 'edited.pdf');
  return request<DocumentRecord>(`/documents/${encodeURIComponent(id)}/content`, {
    method: 'POST',
    body: form,
  });
}

/** Create new AcroForm fields on existing pages (new version). */
export function addFormFields(
  id: string,
  fields: NewFormFieldInput[],
): Promise<DocumentRecord> {
  return requestJSON<DocumentRecord>(
    `/documents/${encodeURIComponent(id)}/form/fields`,
    'POST',
    { fields },
  );
}

/** Insert blank pages so the first becomes page `at` (1-based;
 * pageCount+1 appends at the end). Creates a new version. */
export function insertBlankPages(
  id: string,
  at: number,
  count = 1,
  size?: string,
): Promise<DocumentRecord> {
  return requestJSON<DocumentRecord>(
    `/documents/${encodeURIComponent(id)}/pages/insert`,
    'POST',
    { at, count, ...(size ? { size } : {}) },
  );
}

/** Append pages of another stored document (head version) to this one.
 * Empty/omitted pages appends the whole source. Creates a new version. */
export function appendFromDocument(
  id: string,
  sourceId: string,
  pages?: number[],
): Promise<DocumentRecord> {
  return requestJSON<DocumentRecord>(
    `/documents/${encodeURIComponent(id)}/pages/append-from`,
    'POST',
    { sourceId, ...(pages && pages.length > 0 ? { pages } : {}) },
  );
}

export function getFormFields(id: string): Promise<FormField[]> {
  return request<FormField[]>(`/documents/${encodeURIComponent(id)}/form`);
}

export function fillForm(id: string, values: Record<string, string>): Promise<DocumentRecord> {
  return requestJSON<DocumentRecord>(`/documents/${encodeURIComponent(id)}/form`, 'POST', {
    values,
  });
}

/** URL of the head PDF bytes; version-tagged so caches bust on save. */
export function headPdfUrl(id: string, headVersion: number): string {
  return `${API_BASE}/documents/${encodeURIComponent(id)}?v=${headVersion}`;
}

/** URL of a specific version's PDF bytes. */
export function versionPdfUrl(id: string, n: number): string {
  return `${API_BASE}/documents/${encodeURIComponent(id)}/versions/${n}`;
}

export function fetchHeadBytes(id: string): Promise<ArrayBuffer> {
  return requestBytes(`/documents/${encodeURIComponent(id)}`);
}

/** Multipart upload with progress callbacks (XHR — fetch has no upload progress). */
export function uploadDocument(
  file: File,
  onProgress: (pct: number) => void,
): { promise: Promise<DocumentRecord>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<DocumentRecord>((resolve, reject) => {
    xhr.open('POST', `${API_BASE}/documents`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError('network error during upload', 0));
    xhr.onabort = () => reject(new ApiError('upload canceled', 0));
    xhr.onload = () => {
      const body = xhr.response as { success?: boolean; data?: DocumentRecord; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.success && body.data) {
        resolve(body.data);
      } else {
        reject(new ApiError(body?.error || `upload failed (HTTP ${xhr.status})`, xhr.status));
      }
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Download the head PDF to the user's machine under its document name. */
export async function downloadToDisk(doc: Pick<DocumentRecord, 'id' | 'name'>): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(doc.id)}`);
  if (!res.ok) {
    let msg = `download failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // keep generic message
    }
    emitToast({ type: 'error', title: 'Download failed', msg });
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Duplicate = download head bytes, re-upload under a "(copy)" name. */
export async function duplicateDocument(
  doc: Pick<DocumentRecord, 'id' | 'name'>,
): Promise<DocumentRecord> {
  const bytes = await fetchHeadBytes(doc.id);
  const name = doc.name.replace(/(\.pdf)?$/i, (m) => ` (copy)${m || ''}`);
  const file = new File([bytes], name, { type: 'application/pdf' });
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/documents`, { method: 'POST', body: form });
  try {
    return await unwrap<DocumentRecord>(res);
  } catch (e) {
    if (e instanceof ApiError) {
      emitToast({ type: 'error', title: 'Duplicate failed', msg: e.message });
    }
    throw e;
  }
}
