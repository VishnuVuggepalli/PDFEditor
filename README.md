# PDFEditor

Web-based PDF editor (learning project) — Acrobat-style capabilities built in phases.

- **Frontend:** React + TypeScript + Vite, pdf.js (later mupdf-WASM)
- **Backend:** Go REST API + pdfcpu
- **Design spec:** [docs/superpowers/specs/2026-06-10-pdf-editor-design.md](docs/superpowers/specs/2026-06-10-pdf-editor-design.md)

## Phases

1. View/navigate (upload, render, zoom, thumbnails, search)
2. Page operations (merge, split, reorder, rotate, delete)
3. Annotations (highlight, comment, freehand, shapes)
4. Forms (AcroForm fill, flatten)
5. mupdf-WASM swap → true in-place text/image editing
