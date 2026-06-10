# PDFEditor

Web-based PDF editor (learning project) — Acrobat-style capabilities built in phases.

- **Frontend:** React 18 + TypeScript + Vite, pdf.js (later mupdf-WASM), react-query + zustand
- **Backend:** Go REST API + pdfcpu
- **Design spec:** [docs/superpowers/specs/2026-06-10-pdf-editor-design.md](docs/superpowers/specs/2026-06-10-pdf-editor-design.md)
- **Designer reference:** [docs/design-reference/](docs/design-reference/) (original JSX/CSS + screenshots)

## Running

```bash
docker-compose up -d --build
# app:     http://localhost:8880
# backend: http://localhost:8800 (direct API access)
```

All state lives in `./data` on the host; containers are disposable.

### Development

```bash
# backend tests
cd backend && go test -race ./...

# frontend dev server (proxies /api → localhost:8800)
cd frontend && npm install && npm run dev

# frontend unit tests / build
npm test && npm run build

# browser smoke test (requires the stack running)
BASE_URL=http://localhost:8880 node e2e/smoke.mjs
```

## Architecture notes

- Every mutation creates a new immutable version on disk; the version panel
  can view (read-only) and restore any of them.
- The editor accumulates page ops + annotations in an immutable pending
  queue (undo/redo) and POSTs it on Save.
- Annotation coordinates are converted from viewport pixels to PDF points
  (lower-left origin) with pure viewBox math in `frontend/src/pdf/coords.ts`.
- All pdf.js imports are isolated in `frontend/src/pdf/` so the rendering
  engine can be swapped later.

## Phases

1. ✅ View/navigate (upload, render, zoom, thumbnails, search)
2. ✅ Page operations (merge, split, reorder, rotate, delete)
3. ✅ Annotations (highlight, comment, freehand, shapes)
4. ✅ Forms (AcroForm fill)
5. mupdf-WASM swap → true in-place text/image editing
