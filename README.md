# PDFEditor

[![CI](https://github.com/VishnuVuggepalli/PDFEditor/actions/workflows/ci.yml/badge.svg)](https://github.com/VishnuVuggepalli/PDFEditor/actions/workflows/ci.yml)

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

CI (GitHub Actions, `.github/workflows/ci.yml`) runs on pushes to `main` and
PRs: backend gofmt / go vet / golangci-lint / `go test -race -cover` (raster
tests need `poppler-utils`), frontend eslint / vitest / `tsc -b && vite build`.
The same commands are wrapped by the root `Makefile`:

```bash
make test    # backend go test -race -cover + frontend vitest
make lint    # gofmt + go vet + golangci-lint + eslint
make build   # go build + tsc/vite build
make up      # docker-compose up -d --build  (app :8880, API :8800)
make down
```

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
