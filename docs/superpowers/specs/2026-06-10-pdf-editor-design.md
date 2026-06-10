# PDF Editor — Design Spec

**Date:** 2026-06-10
**Status:** Approved approach: A → C hybrid
**Purpose:** Learning project — web-based PDF editor with Acrobat-style capabilities, built in phases.

## 1. Goal

Build a web PDF editor covering: view/navigate, annotations, page operations,
form filling, and eventually true in-place content editing (text/images), the
way Adobe Acrobat does it.

Key insight driving the architecture: Acrobat's power comes from a single
engine that both renders and edits the same document model. Open-source
equivalent is MuPDF (Artifex). We start with a pragmatic stack (pdf.js +
pdfcpu) and swap the render/edit core to mupdf-WASM in the final phase.

## 2. High-Level Architecture

```
/root/PDFEditor
├── frontend/   React + TypeScript + Vite, pdf.js renderer, SVG annotation overlay
├── backend/    Go REST API, pdfcpu PDF engine, filesystem document store
└── docs/       specs, plans
```

- Browser renders pages and captures edits.
- Go backend owns all document mutations (page ops, annotation persistence,
  form fill) via pdfcpu.
- Documents are versioned immutably: every save produces a new version file;
  originals are never overwritten.
- Phase 5 replaces pdf.js with mupdf-WASM in the browser for true in-place
  editing. The Go backend, REST API, and UI shell survive the swap unchanged.

## 3. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React 18 + TypeScript + Vite | Standard, fast dev loop |
| Rendering (Phases 1–4) | pdf.js | Battle-tested (Firefox viewer), crisp canvas render + selectable text layer |
| Rendering + editing (Phase 5) | mupdf-WASM (mupdf.js) | Closest open-source engine to Acrobat; real content-stream editing, font re-embedding |
| Backend | Go (net/http or chi) | Single binary, strong typing, user expertise |
| PDF engine (backend) | pdfcpu | Pure-Go: merge/split/reorder/rotate/delete, annotations, AcroForm fill, validation |
| Storage | Filesystem behind `DocumentStore` interface | Repository pattern — swappable to S3/DB later |
| Testing | Go table-driven tests, vitest, Playwright E2E | 80% coverage target |

## 4. Backend API (v1)

All responses use the envelope `{success, data, error}` (plus `meta` for
paginated lists).

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/documents` | Upload PDF (validate magic bytes, size cap, pdfcpu validate) |
| `GET  /api/v1/documents` | List documents (paginated) |
| `GET  /api/v1/documents/{id}` | Download current version |
| `GET  /api/v1/documents/{id}/meta` | Page count, version history, form fields |
| `POST /api/v1/documents/{id}/pages/ops` | Page operations: merge, split, reorder, rotate, delete |
| `POST /api/v1/documents/{id}/annotations` | Persist highlights/draw/shapes/stamps into the PDF |
| `POST /api/v1/documents/{id}/form` | Fill AcroForm fields, optional flatten |

- `DocumentStore` interface: `Save`, `Get`, `List`, `Versions`, `NewVersion`.
- Every mutating endpoint returns the new version ID.
- Errors: user-friendly message in envelope; detailed context logged server-side.

## 5. Frontend Components

| Component | Responsibility |
|-----------|----------------|
| `Viewer` | pdf.js canvas + text layer (selection, search), zoom/scroll |
| `AnnotationLayer` | SVG overlay; tools: highlight, comment, freehand, shapes |
| `PageSidebar` | Thumbnails, drag-to-reorder, rotate/delete per page |
| `FormLayer` | Detect AcroForm fields, inline fill UI |
| `Toolbar` | Tool selection, save, undo/redo |

Edit model: user actions accumulate in an immutable operation queue; "Save"
POSTs operations to the backend, which applies them via pdfcpu and returns a
new version. Frontend state is never mutated in place.

## 6. Phases

1. **Skeleton** — upload → render → zoom/scroll/thumbnails/text search.
2. **Page operations** — merge, split, reorder, rotate, delete.
3. **Annotations** — highlight, comment, freehand, shapes; persisted into PDF.
4. **Forms** — AcroForm detection, fill, flatten.
5. **mupdf-WASM core swap** — true click-and-edit text and images in place.

## 7. Error Handling

- Validate all uploads at the boundary: MIME/magic bytes, size cap,
  pdfcpu structural validation. Fail fast with clear messages.
- API envelope carries user-facing error strings; server logs full context.
- Frontend surfaces errors as toasts; no silent failures.

## 8. Testing

- **Unit:** Go table-driven tests for handlers and pdfcpu operations using
  fixture PDFs; vitest for frontend logic (operation queue, reducers).
- **Integration:** API endpoint tests against a temp filesystem store.
- **E2E:** Playwright — upload → render → annotate → save → re-download flow.
- Coverage gate: 80%+.

## 9. Out of Scope (v1)

- Authentication / multi-user accounts
- Digital signatures (cryptographic)
- OCR of scanned documents
- Collaboration / sharing
