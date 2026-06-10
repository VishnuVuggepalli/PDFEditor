/** Types mirroring the Go backend structs (backend/internal/document). */

/** One immutable snapshot of a document. */
export interface Version {
  n: number;
  createdAt: string;
  ops: string;
  size: number;
  sha256: string;
}

/** Application-owned record of an uploaded PDF. */
export interface DocumentRecord {
  id: string;
  name: string;
  createdAt: string;
  headVersion: number;
  versions: Version[];
}

/** Metadata computed live from the PDF bytes. */
export interface PdfInfo {
  pageCount: number;
  encrypted: boolean;
  hasForm: boolean;
}

/** GET /documents/{id}/meta response payload. */
export interface DocumentMeta {
  document: DocumentRecord;
  pdf: PdfInfo;
}

/** One AcroForm field. */
export interface FormField {
  id: string;
  name?: string;
  type: 'text' | 'date' | 'checkbox' | 'radio' | 'combo' | 'list';
  value: string;
  pages: number[];
  locked: boolean;
}

/** Page operations accepted by POST /documents/{id}/pages/ops. */
export type PageOp =
  | { type: 'rotate'; pages: number[]; degrees: number }
  | { type: 'delete'; pages: number[] }
  | { type: 'reorder'; order: number[] };

export type AnnotationType = 'highlight' | 'note' | 'square' | 'ink';

/** One annotation as accepted by POST /documents/{id}/annotations.
 * Rect is in PDF points with a lower-left origin. */
export interface AnnotationInput {
  type: AnnotationType;
  page: number;
  rect: [number, number, number, number];
  color: string;
  contents?: string;
  opacity?: number;
  /** ink only: strokes as flat x,y pairs */
  paths?: number[][];
}
