/** Shared hook + thumbnail for library cards/rows: loads the head PDF once
 * per card and exposes both the handle (for page count) and a thumbnail. */
import { headPdfUrl } from '../../api/documents';
import { usePdfDocument } from '../../pdf/hooks';
import type { PdfDocState } from '../../pdf/hooks';
import type { PdfHandle } from '../../pdf/engine';
import { PdfThumb } from '../../pdf/PdfThumb';

export function useDocPdf(docId: string, headVersion: number): PdfDocState {
  return usePdfDocument(headPdfUrl(docId, headVersion));
}

export function DocThumb({ pdf, width }: { pdf: PdfHandle | null; width: number }) {
  return <div className="sheet-mini">{pdf ? <PdfThumb pdf={pdf} page={1} width={width} /> : null}</div>;
}
