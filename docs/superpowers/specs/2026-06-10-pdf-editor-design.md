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
| Backend | Go + Gin (`gin-gonic/gin`) | Single binary, strong typing, user expertise; Gin confined to the API layer |
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
| `POST /api/v1/documents/{id}/pages/ops` | In-place page operations: rotate, reorder, delete (sequential, validated) |
| `POST /api/v1/documents/merge` | Combine multiple documents into a new document |
| `POST /api/v1/documents/{id}/split` | Extract page ranges into new documents (source untouched) |
| `POST /api/v1/documents/{id}/annotations` | Persist highlights/notes/draw/shapes/text into the PDF |
| `POST /api/v1/documents/{id}/stamp` | Place a visual signature image on one page (multipart: `image` PNG/JPEG ≤5 MB, `page`, `rect` JSON `[llx,lly,urx,ury]` in PDF points; fitted into rect, aspect preserved; ops summary `signature stamp pN`) |
| `POST /api/v1/documents/{id}/form` | Fill AcroForm fields, optional flatten |
| `GET  /api/v1/documents/{id}/versions` | List version history |
| `GET  /api/v1/documents/{id}/versions/{n}` | Download a specific version (read-only) |
| `POST /api/v1/documents/{id}/versions/{n}/restore` | Restore: copy version n as new head version |

- `DocumentStore` interface: `Save`, `Get`, `List`, `Versions`, `NewVersion`.
- Every mutating endpoint returns the new version ID.
- Errors: user-friendly message in envelope; detailed context logged server-side.

### Storage Layout & Metadata

```
data/documents/{uuid}/
├── meta.json     # our metadata (atomic write: temp file + rename)
├── v1.pdf        # original upload — never modified
├── v2.pdf
└── v3.pdf        # head version
```

Two kinds of metadata, stored differently:

1. **Application metadata** (`meta.json`, owned by us): document id, original
   filename, createdAt, headVersion, and a versions array — each entry holds
   version number, timestamp, operation summary, file size, and sha256.
2. **PDF-intrinsic metadata** (owned by the PDF): page count, AcroForm fields,
   encryption status, author. Never duplicated into `meta.json` — computed
   live via pdfcpu on `GET /:id/meta` so it can never drift stale.

JSON sidecar (not SQLite) is deliberate for v1: zero dependencies and
human-readable history. The `DocumentStore` interface hides this choice;
swapping to SQLite/S3 later touches no handler code.

At startup the backend walks `data/documents/*/meta.json` once and builds an
in-memory index (map) for fast list/search. The index is derived state —
rebuilt on every boot, never persisted.

**Retention policy.** Every save writes a full new `vN.pdf`, so unbounded
history grows linearly with edits (a 1.6 MB document edited 50× would hold
80 MB). The store therefore applies a keep-last-N policy on every append:
`MAX_VERSIONS_PER_DOC` (default 20, `0` = unlimited) caps the number of
versions per document. Two hard guarantees override the cap: `v1` (the
original upload) is never pruned, and the current head version is never
pruned. Pruning runs inside `store.AddVersion` under the same write lock as
the append; the oldest non-v1, non-head versions are dropped first.
Survivors keep their version numbers — histories may have gaps (e.g.
`v1, v17..v37`) — so all consumers check version existence against the
`versions` array, never against a contiguous `1..headVersion` range.
meta.json is rewritten atomically (append + prune in one write) before the
pruned `vK.pdf` files and their cached thumbnails (`thumbs/vK-*.png`) are
removed, so a crash can leave an orphaned file at worst — never metadata
pointing at a missing version.

### Deployment — Docker with persistent storage

```
docker-compose.yml
├── backend    Go binary; /app/data mounted from host
├── frontend   nginx serving the built React app, proxies /api to backend
└── bind mount ./data ↔ /app/data   (all state lives on the host)
```

- Containers are stateless and disposable; ALL state (PDF versions +
  `meta.json`) lives in the mounted `./data` directory on the host.
- `docker compose down`, image rebuilds, container deletion — data survives.
  On next `up`, the backend rebuilds its index from the volume and resumes
  exactly where it left off.
- A future database (SQLite file or Postgres container) follows the same
  rule: data files/volumes outside the container lifecycle.

## 5. Frontend Components

| Component | Responsibility |
|-----------|----------------|
| `Viewer` | pdf.js canvas + text layer (selection, search), zoom/scroll |
| `AnnotationLayer` | SVG overlay; tools: highlight, comment, freehand, shapes |
| `PageSidebar` | Thumbnails, drag-to-reorder, rotate/delete per page |
| `FormLayer` | Detect AcroForm fields, inline fill UI |
| `Toolbar` | Tool selection, save, undo/redo |
| `VersionPanel` | Browse version history, preview old versions read-only, restore |

Edit model: user actions accumulate in an immutable operation queue; "Save"
POSTs operations to the backend, which applies them via pdfcpu and returns a
new version. Frontend state is never mutated in place.

## 6. Phases

1. **Skeleton** — upload → render → zoom/scroll/thumbnails/text search.
2. **Page operations** — merge, split, reorder, rotate, delete.
3. **Annotations** — highlight, comment, freehand, shapes; persisted into PDF.
4. **Forms** — AcroForm detection, fill, flatten.
5. **mupdf-WASM core swap** — true click-and-edit text and images in place.

### Phase-5 text-edit font fidelity

In-place edits redact the original line and draw replacement text. Font for
the replacement is chosen deterministically (mupdfFonts.ts / mupdfEdit.ts):

1. **Embedded reuse** — if the original font's program (FontFile/2/3,
   including Type0 descendants) is embedded and its cmap still maps every
   character of the replacement text, the program is re-embedded via
   `addSimpleFont` and reused.
2. **Standard-14 / metric match** — exact standard-14 names pass through
   (including bold/italic faces); metric clones (Arial, Times New Roman,
   Courier New, Nimbus*, Liberation*, …) map to their standard-14
   equivalent using the line's real weight/style flags.
3. **Best effort** — serif/sans/mono from structured text + bold/italic.

Why reuse is conditional, not unconditional: most real-world PDFs embed
*subsetted* programs (`ABCDEF+Name`); subsetting strips or remaps the cmap,
so `Font.encodeCharacter` returns notdef for new text — reusing such a
program would draw tofu. The coverage gate rejects exactly those cases.
Verified against real wasm in parity/fontfidelity.test.ts.

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

## 9. Licensing

mupdf (and its WASM build, mupdf.js) is licensed AGPL-3.0. That license is
**accepted** for this project (decision recorded 2026-06-10): PDFEditor is a
personal, non-distributed tool — it runs only on the owner's own
infrastructure for the owner's own documents, so the AGPL's
network-distribution obligations impose no practical burden, and the full
source is in this repository anyway. If the project were ever distributed
commercially or offered as a service to third parties, the options are a
commercial mupdf license from Artifex or reverting the frontend default to
the pdf.js engine (Apache-2.0), which remains fully functional behind
`VITE_PDF_ENGINE=pdfjs`.

## 10. Out of Scope (v1)

- Authentication / multi-user accounts
- Digital signatures (cryptographic)
- OCR of scanned documents
- Collaboration / sharing

### Why cryptographic signing is deferred

The Sign tool ships with two *visual* modes only: a drawn signature (stored
as an ink annotation) and an uploaded signature image (stamped server-side
via pdfcpu's image watermark API). Neither is a cryptographic signature.
pdfcpu (our only PDF engine in v1) can **validate** existing digital
signatures but cannot **create** them — producing a real PAdES/PKCS#7
signature requires certificate management, a signing engine (e.g.
digitorus/pdfsign or a mupdf-backed phase), trust-store decisions, and a
UX for key material that is far beyond a personal editor's v1. The Sign
menu shows a disabled "Certificates & digital signing" item so the gap is
explicit rather than surprising; revisit when the engine swap (mupdf) or a
dedicated signing library lands.
