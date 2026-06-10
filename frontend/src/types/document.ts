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

/** One AcroForm field to create via POST /documents/{id}/form/fields.
 * Rect is in PDF points with a lower-left origin. */
export interface NewFormFieldInput {
  type: 'text' | 'checkbox';
  /** field name (/T), unique within the document */
  id: string;
  /** tooltip (/TU) */
  label?: string;
  page: number;
  rect: [number, number, number, number];
  /** text only */
  multiline?: boolean;
  /** text: initial value; checkbox: "true" / "false" */
  default?: string;
}

/** One inclusive 1-based page range for POST /documents/{id}/split. */
export interface SplitRange {
  from: number;
  to: number;
}

/** Page operations accepted by POST /documents/{id}/pages/ops. */
export type PageOp =
  | { type: 'rotate'; pages: number[]; degrees: number }
  | { type: 'delete'; pages: number[] }
  | { type: 'reorder'; order: number[] };

export type AnnotationType =
  | 'highlight'
  | 'note'
  | 'square'
  | 'ink'
  | 'text'
  | 'circle'
  | 'line';

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
  /** text only: font size in PDF points (backend whitelist 8..72) */
  fontSize?: number;
  /** text only: optional background color */
  bg?: string;
  /** text/square/circle/line: stroke width in points */
  borderWidth?: number;
  /** line only: [x1,y1,x2,y2] endpoints in PDF points */
  line?: number[];
}
