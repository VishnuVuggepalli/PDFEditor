/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PDF render engine feature flag; defaults to 'pdfjs'. */
  readonly VITE_PDF_ENGINE?: 'pdfjs' | 'mupdf';
}
