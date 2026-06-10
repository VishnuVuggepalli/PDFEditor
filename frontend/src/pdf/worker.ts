/** pdf.js worker wiring for Vite: bundle the worker as an asset URL. */
import { GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let configured = false;

export function ensureWorker(): void {
  if (configured) return;
  GlobalWorkerOptions.workerSrc = workerUrl;
  configured = true;
}
