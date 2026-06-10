import { headPdfUrl } from '../../api/documents';
import { usePdfDocument } from '../../pdf/hooks';
import type { PdfDocState } from '../../pdf/hooks';

/** Load the head PDF of a document once per card/row. */
export function useDocPdf(docId: string, headVersion: number): PdfDocState {
  return usePdfDocument(headPdfUrl(docId, headVersion));
}
