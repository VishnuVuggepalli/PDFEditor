# PDFEditor — Scaling Proposal & Code-Level Gap Audit

**Date:** 2026-06-11
**Scope:** analysis only; no application code changed.
**Method:** full read of the backend (`backend/internal/{api,document,store,pdf,raster,sign,config}`, `cmd/server`), frontend audit (`frontend/src/{api,state,screens,pdf}`), and deployment files. Every claim about current behavior carries a `file:line` anchor.

---

## Executive summary

| Dimension | Recommendation | Effort |
|---|---|---|
| A. Multi-user & auth | Reverse-proxy auth (Authelia or oauth2-proxy) in front of nginx; backend trusts a forwarded-identity header behind a thin middleware; `Owner` field on `Document` with lazy backfill | M |
| B. Index & metadata | Keep the fs store until ~1–2k docs (fix `List` pagination now); then SQLite (WAL, `modernc.org/sqlite`) as index + FTS5 search, fs remains the blob store | M |
| C. Storage | Backups first (restic/rclone of `./data`) — that is what breaks first, not capacity. Content-addressed dedupe over the existing `Version.SHA256` second; S3/minio only if the deployment leaves one box | S → M |
| D. Concurrency / multi-instance | **Do not go multi-instance.** Add optimistic locking (version CAS on save) and per-document locks; scale vertically | M |
| E. Heavy processing | ocrmypdf sidecar + minimal in-process job queue with a `/jobs/:id` status API; no Redis/Postgres queue | M |
| F. Observability | Request-ID middleware + Prometheus `/metrics` + localhost pprof; defer error aggregation | S |

The five most important gap-audit findings (full list in [Deliverable 2](#deliverable-2--code-level-gap-audit)):

1. **G1 (HIGH)** Lost-update window on every edit flow — read head → transform → `AddVersion` with no compare-and-swap (`backend/internal/document/pageops.go:126-156` et al.).
2. **G2 (HIGH)** The store's single `RWMutex` is held across file IO — a 50 MB version write in `AddVersion` blocks *every* request, including reads (`backend/internal/store/fsstore.go:227-256`).
3. **G3 (MED-HIGH)** JSON endpoints have no body-size limit and no annotation-count cap; direct access to :8800 is unbounded (`backend/internal/api/annotations.go:21`, `backend/internal/api/pages.go:21,44,66,87,108`).
4. **G4 (MED)** `GET /documents` returns every document with its full `Versions` array — no pagination; multi-MB responses by a few thousand docs (`backend/internal/api/documents.go:53-60`, `backend/internal/store/fsstore.go:188-200`).
5. **G6/G8 (MED)** Boot-time index rebuild silently skips corrupt `meta.json` without logging (`backend/internal/store/fsstore.go:82-87`), and `writeMetaAtomic` never fsyncs (`backend/internal/store/fsstore.go:115-138`) — together: a crash can make a document vanish with zero trace.

**Recommended next concrete step:** the "now" tier of the roadmap — fix G2/G3/G6/G7/G8 (a day of work), add nightly restic backups of `./data`, and implement optimistic locking (G1) end to end. Everything else can wait for real growth.

---

## 0. Current architecture snapshot (what the code actually does)

- **Process:** one Go binary; Gin router (`backend/internal/api/router.go:13-47`), middleware = `gin.Recovery()`, a one-line slog request logger (`router.go:50-61`), exact-match CORS allowlist (`router.go:66-85`). No auth of any kind.
- **Store:** `FSStore` = `{dataDir}/documents/{uuid}/{meta.json, vN.pdf, thumbs/}` with a single in-memory `map[string]*document.Document` guarded by one `sync.RWMutex` (`backend/internal/store/fsstore.go:38-44`), rebuilt at boot by walking every directory and parsing every `meta.json` (`fsstore.go:73-91`).
- **Versioning:** immutable `vN.pdf` files; append + keep-last-N prune in one meta rewrite under the write lock (`fsstore.go:227-256`, `backend/internal/store/prune.go:25-40`); `Version` already records a SHA-256 of the bytes (`fsstore.go:140-149`).
- **Service:** all mutations are *read head bytes → pdfcpu transform(s) → `AddVersion`* (`backend/internal/document/pageops.go:121-161`, `content.go:14-32`, `annotations.go:111-139`, `sign.go:102-129`, `pageinsert.go:21-110`). Everything is `[]byte` end to end (`backend/internal/document/service.go:10-61`).
- **Engine:** pdfcpu, sole importer (`backend/internal/pdf/engine.go:1-15`), decompression-bomb limits 200 MB (`engine.go:29-38`). Signature validation through pdfcpu's process-global `model.UserCertPool` (`backend/internal/pdf/signatures.go:17-36`).
- **Thumbnails:** pdftoppm subprocess (poppler, installed in the image — `backend/Dockerfile:13-17`), 10 s timeout (`backend/internal/raster/pdftoppm.go:22,64`), per-process singleflight + weighted semaphore of 4 (`backend/internal/document/thumbnails.go:30,47-48`), disk cache keyed by `v{N}-p{page}-w{width}` (`thumbnails.go:128-131`).
- **Limits:** upload 50 MB via `MaxBytesReader` (`backend/internal/api/documents.go:29`, `backend/internal/config/config.go:23,67`); content-replace 50 MB hardcoded (`backend/internal/document/content.go:9`); stamp image 5 MB (`backend/internal/document/stamp.go:10`); nginx `client_max_body_size 60m` (`frontend/nginx.conf:16`).
- **Deployment:** docker-compose; backend bound to `127.0.0.1:8800` (`docker-compose.yml:24-27`), nginx public on :8880 proxying `/api/` (`frontend/nginx.conf:18-28`); all state in host-mounted `./data` (`docker-compose.yml:19-23`).
- **Frontend:** fetch wrapper with envelope unwrapping and toast-on-error, no auth headers (`frontend/src/api/client.ts:6,45-62`); react-query with 5 s staleTime (`frontend/src/main.tsx:11-19`); zustand editor store re-initialized per document (`frontend/src/state/editorStore.ts:140-152`); saves post pending ops sequentially then invalidate (`frontend/src/screens/EditorScreen.tsx:169-210`); in-place edits post whole PDFs via `replaceContent` (`frontend/src/api/documents.ts:118`, `EditorScreen.tsx:246-255`). No version/conflict information is ever sent.

Current data: 9 documents, `meta.json` measured at **374 B (1 version) to 1,301 B**; ~230 B per version entry, so ≈ **4.7 KB per doc at the 20-version cap** (`MAX_VERSIONS_PER_DOC`, `docker-compose.yml:15`).

---

# Deliverable 1 — Scaling options

## A. Multi-user & auth

**Today:** zero identity anywhere. No middleware besides recovery/logging/CORS (`router.go:15`); `Document` has no owner (`backend/internal/document/model.go:20-26`); the frontend has no auth state, no login screen, no `Authorization` header path (`frontend/src/api/client.ts:45-62`, `frontend/src/main.tsx:11-19`).

### Options

**A1 — Reverse-proxy auth (Authelia or oauth2-proxy in front of nginx). Recommended.**
- nginx gains an `auth_request` block; the proxy injects `Remote-User` (Authelia) / `X-Auth-Request-User` (oauth2-proxy) on every `/api/` request.
- Backend adds *one* middleware that reads the header into the gin context; it must also reject requests lacking it (defense in depth — the backend port is already localhost-only, `docker-compose.yml:27`).
- Cookie-based: the frontend needs almost nothing — a logout link and a 401/302 handler in `unwrap` (`client.ts:45-62`).
- Trade-offs: + smallest code delta, + battle-tested login/2FA/session handling for free, + upgrade path to real OIDC IdPs; − another container, − identity is a trusted header (must never expose :8800 beyond localhost).
- **Effort: S for oauth2-proxy against GitHub/Google, M for Authelia (local user db, 2FA). Deps: one container; ~40 lines of Go.**

**A2 — Built-in session auth (users file + bcrypt + cookie sessions).**
- `users.json` under `{dataDir}`, `golang.org/x/crypto/bcrypt`, `POST /api/v1/login`, HttpOnly cookie, session map or signed cookie.
- Trade-offs: + no new infrastructure, + works offline; − you own password storage, CSRF, rate limiting, session revocation — the exact code you least want to hand-roll; − frontend needs a login screen + route guard.
- **Effort: M. Deps: bcrypt, a session lib or hand-rolled HMAC cookies.**

**A3 — Full OIDC inside the backend (`coreos/go-oidc` + JWT verification).**
- Backend validates bearer tokens; frontend runs an OIDC code+PKCE flow.
- Trade-offs: + stateless, API-friendly for future non-browser clients; − the most code on both sides, − needs an IdP anyway (dex, Keycloak) — at which point A1 gives the same IdP with a tenth of the code.
- **Effort: L.**

### Exact insertion points (applies to all options)

1. **Middleware** — `backend/internal/api/router.go:15`: append `authIdentity()` to the `r.Use(...)` chain (or on the `v1` group at `router.go:19` to keep `/healthz` open). It sets `c.Set("user", ...)`; handlers read it via a small helper.
2. **Ownership model** — `backend/internal/document/model.go:20-26`: add `Owner string \`json:"owner,omitempty"\`` to `Document`. `omitempty` is the migration story: every existing `meta.json` under `data/documents/*` simply unmarshals with `Owner == ""`.
3. **Migration of existing data** — two layers:
   - *Lazy:* treat `Owner == ""` as "legacy, owned by the configured admin" (`LEGACY_OWNER` env, default first user). Zero touch of disk.
   - *Eager (optional one-shot):* at the end of `rebuildIndex` (`fsstore.go:73-91`), backfill `Owner` and `writeMetaAtomic` each patched record once. Idempotent, runs in seconds at this scale.
4. **Store interface** — `backend/internal/document/service.go:10-28`. Two viable shapes:
   - *(a) Store stays tenant-blind; the service authorizes.* `Service` methods grow a `user string` parameter; after `store.Get` they check `doc.Owner`; `List(ctx)` is filtered in the service. Only `Store.Create(ctx, name, pdf)` changes, gaining `owner string` (impl: `fsstore.go:152-174` writes it into the new record). **Recommended** — keeps all eight `Store` methods' contracts intact and keeps authorization in one layer.
   - *(b) Fully scoped store:* `Get/List/Rename/Delete/AddVersion/...` all gain `owner`; `List` needs a per-owner index. More churn for no benefit at this scale; revisit if the store ever becomes SQL (where it's a `WHERE owner = ?`).
5. **Handlers** — every handler in `backend/internal/api/{documents,pages,annotations,forms,content,stamp,sign,thumbnails}.go` passes `currentUser(c)` into the service call. Mechanical, ~25 call sites.
6. **Frontend** — with A1: handle 401/redirect in `frontend/src/api/client.ts:45-62`, show the user name, add `/logout`. With A2/A3 additionally: an auth zustand store, a login screen, and a guard around the editor route in `frontend/src/App.tsx`.

**Recommendation:** A1 + ownership shape (a). It threads identity through exactly three places (middleware, `Document.Owner`, service checks) and defers every hard auth problem to software whose whole job is auth.

---

## B. Index & metadata at scale

**Today:** the entire catalog is a Go map rebuilt by reading every `meta.json` at boot (`fsstore.go:73-91`); `List` copies and sorts the whole map per call (`fsstore.go:188-200`) and the handler returns it all, full version history included (`backend/internal/api/documents.go:53-60`). There is no name search and no content search; the frontend filters the full list client-side.

### When does it hurt? (measured numbers)

Per-doc cost at the 20-version cap ≈ 4.7 KB JSON on disk; in memory ≈ 3.5 KB (20 × ~160 B `Version` structs + map overhead).

| Docs | Boot walk (N× open+read+parse) | Index RAM | `GET /documents` response |
|---|---|---|---|
| 10 | instant | ~50 KB | ~50 KB |
| 1,000 | < 1 s warm SSD | ~4 MB | **~5 MB** — already sluggish in the browser |
| 10,000 | 2–5 s SSD; minutes on cold spinning disk (10k seeks) | ~35 MB | ~50 MB — unusable |
| 50,000 | 10–30 s SSD | ~175–350 MB incl. GC headroom | ~235 MB — broken |

So: **RAM and boot are fine to ~10k docs; the unpaginated `List` response is the real cliff and it arrives around 1–2k docs.** That makes pagination a *now* fix (gap G4) independent of any storage change.

### Options

**B1 — Keep fs store; fix the API. (Do now regardless.)**
- Add `?limit=&offset=` (or cursor on `createdAt`) + a summary DTO (id, name, createdAt, headVersion, head size — *not* the `Versions` array) to `List`. Seam: handler `documents.go:53-60` + a `ListPage` method beside `Store.List` (`service.go:15-16`).
- Name search: at fs scale, a `strings.Contains` filter inside the service over the in-memory index is honestly fine to ~10k docs.
- **Effort: S. Deps: none.**

**B2 — SQLite (WAL) as index + search; fs keeps the bytes. Recommended at ~1–2k docs.**
- One `documents` table + one `versions` table mirroring `meta.json`; `PRAGMA journal_mode=WAL` for concurrent readers + single writer — exactly this app's profile.
- **Seam:** `document.Store` (`service.go:10-28`) is the interface; ship a `sqlitestore.Store`. Which `FSStore` methods are *reimplemented* vs *wrapped*:
  - Reimplemented against SQL: `Get`, `List` (paginated, indexed, searchable), `Rename`, `AddVersion` metadata + prune plan (a transaction replaces the `writeMetaAtomic` dance, `fsstore.go:113-138` disappears), `DeleteVersion` guards (`fsstore.go:305-348` become `WHERE` clauses), `Delete`.
  - Wrapped/kept: the *file* halves — `VersionBytes` (`fsstore.go:205-218`), version-file write in `AddVersion` (`fsstore.go:237-239`), `os.RemoveAll` in `Delete` (`fsstore.go:287`), thumb cleanup (`fsstore.go:352-364`). The blob layout on disk does not change, so migration = one boot-time import of existing `meta.json` files (the walk at `fsstore.go:73-91` becomes the importer) — keep `meta.json` writes as a belt-and-suspenders export or drop them.
- **Search:** FTS5 virtual table over name + extracted text. **Text-extraction hook:** server-side via `pdftotext` — *already in the image*, poppler-utils ships it next to the pdftoppm the raster package shells out to (`backend/Dockerfile:13-17`, `backend/internal/raster/pdftoppm.go:104-112` is the pattern to copy). Index on upload and on `AddVersion`, asynchronously (see E's worker pool). The mupdf-WASM client-side extraction (frontend worker) is the wrong hook for a server index — it only runs when someone opens the doc in a browser.
- Trade-offs: + transactional metadata (kills G6/G8 class issues), + real pagination/search, + jobs table for E rides along; − a schema to migrate, − pick `modernc.org/sqlite` (pure Go, keeps CGO_ENABLED=0 builds) over `mattn/go-sqlite3`.
- **Effort: M. Deps: `modernc.org/sqlite`.**

**B3 — bbolt (or an fs-store + persisted index file).**
- Single-file KV; the index becomes one bucket, boot is one mmap.
- Trade-offs: + tiny dep, pure Go; − no query language, **no FTS** (you'd bolt on bleve at +1 heavy dep and its own index lifecycle), pagination/sort hand-rolled. bleve's index for 50k docs of extracted text is also substantially larger and slower to build than FTS5.
- **Effort: M, but buys less than B2.**

**Recommendation:** B1 immediately; B2 when the catalog approaches 1k docs or the moment search is wanted, with FTS5 + `pdftotext` (skip bleve).

---

## C. Storage at scale

**Today:** everything under one host bind mount (`docker-compose.yml:19-23`). What breaks first, in order:

1. **No backup.** A single `rm -rf`, disk death, or a bad host upgrade loses every document and the signing identity (`{dataDir}/keys`, `backend/cmd/server/main.go:76-81`). This is the *only* storage problem the project actually has today.
2. **No dedupe.** `RestoreVersion` writes a byte-identical copy as a new version (`backend/internal/document/service.go:183-193`); 20 versions of a 50 MB scan = 1 GB for one document. The SHA-256 needed for dedupe is already computed and stored per version (`fsstore.go:140-149`).
3. **Single disk / single host.** Capacity and IOPS — years away at personal/small-team scale.

### Options

**C1 — Stay on fs; add backups. Recommended now.**
- Nightly `restic` (or rclone to any cloud bucket) of `./data`; the store's atomic-rename discipline means a live snapshot is consistent-enough (worst case: an orphaned `vN.pdf`, which the code already tolerates by design — `fsstore.go:224-226,253-255`).
- **Effort: S. Deps: none in-app.**

**C2 — Content-addressed blob layer using the existing `Version.SHA256`.**
- Store bytes at `{dataDir}/blobs/{sha256[:2]}/{sha256}`; `vN.pdf` entries become references (the `Version.SHA256` field *is* the pointer already — `model.go:9-15`). Refcount or mark-and-sweep GC on delete/prune (`prune.go:45-52` and `fsstore.go:343-346` become decrefs).
- Kills the restore-duplication cost and makes cross-document dedupe (split/merge outputs) free.
- Trade-offs: + large disk savings for version-heavy use; − GC is the classic footgun (do mark-and-sweep offline, not refcounts, if B2's transactions aren't in yet).
- **Effort: M. Do after B2** so reference tracking is transactional.

**C3 — S3/minio behind a new `Store` implementation.**
- Same seam as B2: implement `document.Store` (`service.go:10-28`) over a bucket; metadata must move to SQL first (B2) because S3 has no atomic read-modify-write for `meta.json`.
- **The `[]byte`-everywhere problem.** Current signatures buffer whole PDFs at every layer; for a 50 MB PDF each request holds 100–250 MB transiently (input copy + transform output + pdfcpu internals). Every place that would need `io.Reader`/`io.ReadCloser` plumbing for true streaming:
  - `Store.Create(ctx, name, pdf []byte)`, `Store.VersionBytes(...) ([]byte, ...)`, `Store.AddVersion(ctx, id, pdf []byte, ops)` — `backend/internal/document/service.go:11-20`.
  - `Service.Download` returning `[]byte` (`service.go:120-130`) and the handlers that buffer responses: `c.Data(...)` at `backend/internal/api/documents.go:70` and `documents.go:146`.
  - Request side `io.ReadAll`: `backend/internal/api/documents.go:38` (upload), `backend/internal/api/content.go:36` (content replace), `backend/internal/api/stamp.go` (image).
  - `Engine` methods, all `[]byte` in/out — `service.go:32-61` (`Validate`, `Info`, `Rotate`, `DeletePages`, `Reorder`, `Merge`, `ExtractPages`, `Annotate`, `StampImage`, `FormFields`, `FillForm`, `AddFormFields`, `InsertBlankPages`).
  - `Rasterizer.PagePNG(ctx, pdf []byte, ...)` (`backend/internal/document/thumbnails.go:16-20`) and the temp-file staging in `raster/pdftoppm.go:67-79`.
  - `Signer.Sign(pdf []byte, req)` (`backend/internal/document/sign.go:27-33`).
  - **Honest caveat:** pdfcpu wants an `io.ReadSeeker` and materializes the document anyway (`backend/internal/pdf/engine.go:47,55`), so streaming only genuinely helps the pure up/download paths (`Download`, `DownloadVersion`, `Upload` pass-through to disk, `VersionBytes`). Stream those four; leave the transform paths buffered.
- Trade-offs: + offsite durability, multi-host ready; − latency on every read (thumbnails re-read head bytes per request — `thumbnails.go:72`), needs a local cache layer, most code churn of any proposal here.
- **Effort: L. Deps: minio-go or aws-sdk-go-v2. Only worth it when the deployment outgrows one machine.**

**Recommendation:** C1 this week; C2 after B2; C3 only with a concrete multi-host requirement.

---

## D. Concurrency & multi-instance

### Single-process assumptions, enumerated

1. **One global `RWMutex` for the whole catalog** (`fsstore.go:42-43`); write lock held *during file IO*: 50 MB `os.WriteFile` + meta marshal/rename + prune unlinks in `AddVersion` (`fsstore.go:227-256`), `os.RemoveAll` of a whole doc dir in `Delete` (`fsstore.go:280-292`), version-file + thumb-glob removal in `DeleteVersion` (`fsstore.go:336-347`). One slow save stalls every other request, reads included. (Gap G2.)
2. **In-memory index is the source of truth after boot** (`fsstore.go:73-91`); nothing ever re-reads disk.
3. **Per-process singleflight + render semaphore** (`thumbnails.go:47-48`, cap 4 at `thumbnails.go:30`).
4. **Process-global pdfcpu trust pool**, populated once at startup (`backend/internal/pdf/signatures.go:17-35`, `cmd/server/main.go:50-54`).
5. **Signing identity generated on first boot** with an exists-check-then-create sequence (`backend/internal/sign/identity.go:76-93`).

### What breaks with 2 replicas on shared storage — every spot

- **Index divergence:** replica A's `Create`/`Rename`/`Delete` mutates only its own map (`fsstore.go:170-172,275,290`); replica B serves stale or phantom documents until restart. `fsstore.go:73-91` runs once.
- **Version-number collision + meta clobber:** both replicas compute `n = cur.HeadVersion + 1` from their own index (`fsstore.go:236`) and both `os.WriteFile(versionPath(id,n))` (`fsstore.go:237`) — same filename, one version's bytes silently overwritten — then both `writeMetaAtomic` (`fsstore.go:248`), last rename wins, the other's version entry vanishes from history while its file may linger as an orphan.
- **Prune races:** replica A prunes vK (`prune.go:45-52`) while replica B (stale index) still serves it via `VersionBytes` → read error surfaces as 500 (`fsstore.go:213-216`).
- **Delete vs everything:** A `RemoveAll`s the dir (`fsstore.go:287`) while B mid-`AddVersion` recreates files into a half-deleted dir.
- **Thumbnail stampede across replicas:** singleflight is per-process (`thumbnails.go:47`), so the worst-case concurrent pdftoppm count doubles per replica (cap 4 each, `thumbnails.go:30`). Benign-ish: the atomic cache write (`thumbnails.go:135-157`) is rename-safe cross-process.
- **Identity TOCTOU:** two fresh replicas racing `LoadOrCreateIdentity` (`identity.go:80-92`) can each generate a key; last `writeFileAtomic` wins (`identity.go:122-127`) and one replica signs with a key whose cert is no longer on disk — and only its own in-process trust pool (`signatures.go:34`) knows its cert.

### Is multi-instance worth it? Honest answer: **no.**

The workload is short CPU bursts (pdfcpu transforms, pdftoppm renders) over small working sets. A single modern box (8 cores / 16 GB) sustains 50 active users comfortably once G2 (lock-over-IO) is fixed; the semaphore already protects against render storms. Going multi-instance requires B2 (shared SQL metadata) + C3 (shared blobs) + distributed locking — an L-effort rewrite that buys availability the project doesn't need. The one component worth extracting *if* render load ever dominates is a stateless thumbnail/raster worker — it's already side-effect-free bytes-in/PNG-out (`raster/pdftoppm.go:53-100`).

### Optimistic locking for concurrent editors (do this regardless — it's a 2-browser-tabs bug today, gap G1/G16)

Exact changes:

- **Model/errors:** `ErrConflict` in `backend/internal/document/errors.go:5-15`; map to HTTP 409 in `fail` (`backend/internal/api/envelope.go:33-42`).
- **Store:** `AddVersion(ctx, id, pdf, ops string, expectedHead int)` (`service.go:19-20`); in `fsstore.go:227-256`, after the index lookup: `if expectedHead != 0 && cur.HeadVersion != expectedHead { return nil, ErrConflict }` — under the same write lock, so it is a true CAS. `0` = legacy/unchecked, keeping `RestoreVersion` (`service.go:183-193`) and internal callers working.
- **Service:** every mutate flow threads a `baseVersion` parameter into its `AddVersion` call: `ApplyPageOps` (`pageops.go:156`), `ReplaceContent` (`content.go:27`), `Annotate` (`annotations.go:134`), `Stamp`, `Sign` (`sign.go:124`), `FillForm`, `AddFormFields`, `InsertBlankPages` (`pageinsert.go:56`), `AppendFromDocument` (`pageinsert.go:105`).
- **Handlers:** accept `baseVersion` in each JSON body (`api/pages.go`, `api/annotations.go`, `api/forms.go`, `api/sign.go`) and as a form field on the multipart routes (`api/content.go:29-40`, `api/stamp.go`).
- **Frontend:** the editor already knows the head it loaded (`meta.document.headVersion` via the meta query, `frontend/src/screens/EditorScreen.tsx:134-147`); send it from `doSave` (`EditorScreen.tsx:169-210` — note it already tracks `lastVersion` between sequential calls, so chain it: annotations response version becomes the stamps call's base) and from `onContentEdited` (`EditorScreen.tsx:246-255` / `frontend/src/api/documents.ts:118`). On 409: toast "document changed elsewhere", refetch meta, keep pending ops for replay (the store already preserves pending state on error, `EditorScreen.tsx:205-207`).

**Effort: M (mechanical but wide). Deps: none.**

---

## E. Heavy processing

**Today's bounds:** upload 50 MB (`api/documents.go:29` ← `config.go:23,67`); content-replace 50 MB hardcoded (`document/content.go:9,18` — decoupled from config, gap G9); pdfcpu stream/decode caps 200 MB (`pdf/engine.go:29-38`); pdftoppm 10 s timeout, 4 concurrent (`raster/pdftoppm.go:22`, `thumbnails.go:30`). **No background-job machinery exists** — every operation is synchronous inside the HTTP request, bounded by the server's 5 m read / 60 s write timeouts (`cmd/server/main.go:65-68`).

### OCR

- **E1 — ocrmypdf sidecar container + minimal in-process queue. Recommended.** ocrmypdf (tesseract + ghostscript) as a compose service with a tiny HTTP shim, or simpler: install in the backend image and shell out exactly like raster does (`raster/pdftoppm.go:104-112` is the template; `exec.CommandContext`, stderr capture, timeout — but minutes, not 10 s, hence async). Output becomes a new version (`AddVersion`, ops "ocr"), which also feeds B2's FTS text.
- **E2 — asynq (Redis) or E3 — river (Postgres):** real queues with retries/scheduling, but each drags in a stateful service the stack doesn't otherwise need. Wrong size for this project.

### Background-jobs pattern (minimal, reusable for OCR, bulk export, text indexing)

- In-process worker pool: 1–2 goroutines, buffered channel, jobs persisted to the B2 SQLite `jobs` table (id, docID, kind, status, error, resultVersion, timestamps) so a restart shows `failed`/`interrupted` instead of amnesia. Pre-B2: an in-memory map is acceptable for a personal tool, with jobs lost on restart documented.
- **What becomes async:** anything that can exceed ~10 s — OCR first; later candidates: merge of many large docs (`pageops.go:165-191`), bulk text extraction.
- **API shape:**
  - `POST /api/v1/documents/:id/ocr` → `202 {"success":true,"data":{"jobId":"…","status":"queued"}}`
  - `GET /api/v1/jobs/:id` → `{"status":"queued|running|done|failed","error":null,"resultVersion":7}`
  - Frontend polls with react-query `refetchInterval` (no websockets needed at this scale).

### Large files

Raising past 50 MB is mostly multiplying the buffered-`[]byte` cost (see C3's list); if 100–200 MB scans become real, do it *after* streaming the pure download paths and keep transforms capped. The pdfcpu 200 MB decode ceiling (`engine.go:29`) is the next wall and is deliberate bomb protection — raise consciously, per-deployment, not by default.

**Effort: M (worker pool + jobs table + one OCR endpoint). Deps: ocrmypdf/tesseract in an image (~700 MB — the sidecar keeps the backend image slim).**

---

## F. Observability

**Today:** structured slog JSON to stdout (`cmd/server/main.go:84`), one line per request — method/path/status/duration only (`router.go:50-61`), error logs in `fail` (`envelope.go:44-49`). No request IDs, no metrics, no pprof.

Minimal prod-grade set, all S effort:

1. **Request IDs:** middleware before the logger at `router.go:15` — honor inbound `X-Request-ID` (nginx already forwards real IPs, `frontend/nginx.conf:24-25`; add `proxy_set_header X-Request-ID $request_id;`), generate otherwise, set on response + into a request-scoped slog logger so `fail`'s error lines (`envelope.go:44-49`) correlate with request lines. Today a 500 cannot be matched to its request log entry.
2. **Prometheus `/metrics`:** mount `promhttp.Handler()` via `gin.WrapH` next to `/healthz` (`router.go:17`). Safe by topology: backend is localhost-bound (`docker-compose.yml:27`) and nginx only proxies `/api/` (`frontend/nginx.conf:18`), so `/metrics` is not publicly reachable. Instrument: request count/duration/status by route, store op durations, thumbnail cache hit/miss, render semaphore wait (`thumbnails.go:110`), version-file sizes. Deps: `prometheus/client_golang`.
3. **pprof:** a second `http.Server` on `127.0.0.1:6060` with `net/http/pprof` in `run()` (`main.go:83-120`) — never on the Gin router.
4. **Error aggregation:** at this scale, JSON logs + `docker logs`/Loki is enough; add Sentry (`sentry-go`) only when someone other than the author operates it. Also fix G13 (4xx logged at Error level) so an aggregator isn't 95 % noise.

---

## Ordered adoption roadmap

**Tier 1 — now (10 docs / 1 user):** *make the current box safe*
1. C1 backups of `./data` (includes `keys/`).
2. Gap fixes G2, G3, G6, G7, G8, G13 (small, listed below).
3. D's optimistic locking (G1) — it is a two-tabs bug today, not a multi-user feature.
4. F observability bundle (request IDs, `/metrics`, pprof).
5. B1 `List` pagination + summary DTO (the frontend list screen adapts trivially).

**Tier 2 — growth (≈1k docs / 5 users):**
6. A1 auth proxy + `Owner` field + service-level authorization + lazy backfill.
7. B2 SQLite WAL index (+ jobs table), FTS5 name search; `pdftotext` content indexing as a background job.
8. E worker pool + OCR endpoint (if OCR is wanted).
9. Per-document locking / G2's lock split if save latency is ever felt.

**Tier 3 — small-team scale (≈50k docs / 50 users):**
10. C2 content-addressed blobs (dedupe) on top of B2 transactions.
11. Re-evaluate multi-instance honestly: expected answer is still "bigger box + restore-tested backups". If availability becomes a hard requirement, the path is B2→Postgres + C3 minio/S3 + sticky single-writer per document — a project, not a patch.
12. Frontend: virtualized document list, server-driven search.

---

# Deliverable 2 — Code-level gap audit

Severity: **HIGH** = correctness/data-loss path reachable today; **MED** = latent bug or scaling landmine; **LOW** = polish/edge.

| # | Sev | Location | Finding | Fix sketch |
|---|---|---|---|---|
| G1 | HIGH | `backend/internal/document/pageops.go:126-156`; also `content.go:14-31`, `annotations.go:111-139`, `sign.go:102-129`, `pageinsert.go:21-110`, `forms.go`, `formcreate.go`, `stamp.go` | Every edit is read-head → transform → `AddVersion` with no CAS: two concurrent editors (or two tabs) both succeed and the first writer's change silently vanishes from the head lineage | `expectedHead` CAS in `AddVersion` + 409; see §D |
| G2 | HIGH | `backend/internal/store/fsstore.go:227-256` (`AddVersion`: 50 MB `os.WriteFile` at :237 + meta write at :248 + prune unlinks at :255 under `s.mu.Lock()`); same pattern `Delete` :280-292 (`RemoveAll` :287), `DeleteVersion` :336-347 | Global write lock held across file IO — one slow save/delete blocks **all** requests including pure reads (`Get`/`List` take RLock) | Stage `vN.pdf` to a temp name before locking; under the lock only CAS-check, rename, write meta, swap index; move unlinks after unlock. Longer term: per-document mutex map |
| G3 | MED-HIGH | `backend/internal/api/annotations.go:21`, `api/pages.go:21,44,66,87,108`, `api/forms.go:31,52`, `api/sign.go:27`, `api/documents.go:93` | JSON endpoints have no `MaxBytesReader` (only the three multipart routes do — `documents.go:29`, `content.go:26`, `stamp.go:28`) and `Annotate` has no count cap (`document/annotations.go:112-115` checks only non-empty). nginx caps proxied bodies at 60 MB (`nginx.conf:16`) but direct :8800 access is unbounded; a 60 MB annotations array still OOM-amplifies through pdfcpu | Shared `limitJSONBody(1<<20)` middleware on the v1 group + `maxAnnotations` (e.g. 500) in `validateAnnotation`'s caller |
| G4 | MED | `backend/internal/api/documents.go:53-60`, `backend/internal/store/fsstore.go:188-200`, `frontend/src/api/documents.ts` (list fetch) | `GET /documents` returns every doc **with full `Versions` arrays**, unpaginated; ~5 MB at 1k docs (math in §B) | `?limit/offset` + summary DTO without versions |
| G5 | MED | `backend/internal/document/thumbnails.go:85-91,110` | singleflight leader's `ctx` governs the shared render: if the first requester disconnects, `sem.Acquire(ctx)`/pdftoppm abort and **all** joined waiters get its cancellation error | Run the flight fn on `context.WithTimeout(context.Background(), …)` detached from the leader |
| G6 | MED | `backend/internal/store/fsstore.go:82-87` | `rebuildIndex` silently `continue`s past corrupt/unreadable `meta.json` — a document disappears from the app with **zero log line** (comment at :84-85 promises "manual inspection" no one is told to do) | `slog.Warn("skipping corrupt doc", "id", e.Name(), "err", err)` |
| G7 | MED | `backend/internal/store/fsstore.go:160-168` | `Create` error path drops cleanup: after `MkdirAll`, a failed `WriteFile`/meta write returns leaving an orphan dir (with possibly a stray `v1.pdf`, no meta) that survives forever and is re-skipped by G6 on every boot | `defer`red `os.RemoveAll(docDir)` on error before the index insert |
| G8 | MED | `backend/internal/store/fsstore.go:115-138`; same pattern `document/thumbnails.go:135-157`, `sign/identity.go:122-127` | `writeMetaAtomic` renames without `tmp.Sync()` (or dir fsync): atomic vs *crash* but not vs *power loss* — meta.json can come back empty/old while `vN.pdf` exists → vanished version or (with G6) silently vanished document | `tmp.Sync()` before `Close`; optionally fsync the dir after rename (meta path only; thumbs are disposable) |
| G9 | LOW-MED | `backend/internal/document/content.go:9,18` vs `backend/internal/config/config.go:23,44-50,67` | `MaxContentPDFBytes` (50 MB) is a const while the upload cap is configurable: set `MAX_UPLOAD_MB=100`, upload a 60 MB PDF — it can never be text-edited (every content save 400s). Same coupling smell: `nginx.conf:16` (60m) must track both | Derive the content cap from `Config.MaxUploadBytes()` (inject into `NewHandlers`/service), document the nginx pairing |
| G10 | LOW | `backend/internal/store/fsstore.go:205-218` | TOCTOU: `Get` checks `hasVersion` under RLock, file read happens after release; a concurrent `DeleteVersion`/prune unlink turns it into a wrapped `os.PathError` → surfaces as **500**, should be 404 | `if os.IsNotExist(err) { return nil, ErrNotFound }` at :214 |
| G11 | LOW | `backend/internal/document/service.go:32-61` (whole `Engine` interface), e.g. loop `pageops.go:136-154` | No `ctx` on any engine method: pdfcpu transforms (up to the 200 MB decode cap, `pdf/engine.go:29`) are uncancellable; a disconnected client's multi-op request runs to completion | Add `ctx` to `Engine` methods (pdfcpu itself won't honor it, but check `ctx.Err()` between ops in the `ApplyPageOps` loop) |
| G12 | LOW | `backend/internal/sign/identity.go:76-93,120-127` | exists-check → generate → write race: harmless single-process, but two processes sharing `DATA_DIR` (e.g. compose scale typo) can split-brain the signing identity; each replica also only trusts its own cert in-process (`pdf/signatures.go:25-36`) | `O_CREATE|O_EXCL` lock file in the keys dir, or document single-writer requirement |
| G13 | LOW | `backend/internal/api/envelope.go:44-49` | Every failure including routine 404/400 logs at `Error` level — drowns real errors, poisons future alerting | `slog.Warn` for status < 500, `Error` for 5xx |
| G14 | LOW | `backend/internal/api/thumbnails.go:46-49` | `Cache-Control: public, max-age=3600` is keyed only by URL; correctness relies on every client version-tagging (`?v=N`) as the comment admits — a non-tagging client (curl, future integration) gets up to 1 h stale thumbs | Add `ETag` = cache filename (`v{N}-p{p}-w{w}`) and/or include version in the path |
| G15 | MED (frontend) | `frontend/src/state/editorStore.ts:108-116` (`commit` pushes to `past` unbounded; cleared only on doc switch at :140-152) | Undo history grows without limit within a long editing session (each snapshot = full pages+annots+stamps+fields arrays; stamps carry base64 dataURLs — `frontend/src/state/opsQueue.ts:54-55`) | Cap `past` at ~50: `past: [...s.past.slice(-49), snapshot]` |
| G16 | MED (frontend) | `frontend/src/screens/EditorScreen.tsx:169-210` (`doSave`), `:246-255` (`onContentEdited`), `frontend/src/api/documents.ts:118` (`replaceContent`) | No base-version sent on any save: the client half of G1. Two tabs on one doc silently last-writer-win; pending ops also reference page snapshots from the loaded version | Send `baseVersion` (from the meta query) once the backend 409 path exists; on 409 refetch + keep pending ops (preserved-on-error already works, `EditorScreen.tsx:205-207`) |
| G17 | LOW (frontend) | `frontend/src/api/client.ts:45-62` | `unwrap` has no 401/redirect branch — fine today (no auth), but it is the single insertion point for A1 and worth noting as the only auth seam | Add `if (res.status === 401) window.location.assign('/login')` (or proxy redirect) when auth lands |
| G18 | LOW | `backend/internal/api/documents.go:31-44`, `cmd/server/main.go:67` | Upload buffers the whole file via `io.ReadAll` after gin's multipart parse (32 MB in-memory threshold then temp files): 10 concurrent 50 MB uploads ≈ 500 MB+ transient RAM, amplified by `Validate`'s full pdfcpu parse (`engine.go:43-51`). Bounded but worth knowing before raising `MAX_UPLOAD_MB` | Acceptable at current caps; if caps rise, stream multipart part → temp file → `Validate` from file |

### Areas checked and found clean

**Backend**
- Prune semantics: v1 + head always survive, order preserved, gaps intentional (`store/prune.go:25-40`); prune file removal correctly happens *after* meta commit so crashes only orphan files (`fsstore.go:224-226,245-255`).
- `DeleteVersion` guards (v1/head/last) enforced under the store lock — no race with `AddVersion` head movement (`fsstore.go:305-324`).
- Deep-copy discipline: indexed records never escape (`copyDoc`, `fsstore.go:376-382`); store replaces, never mutates (`fsstore.go:241-244`).
- Thumbnail cache invalidation by construction: version-keyed filenames (`thumbnails.go:35-39,128-131`); double-checked disk read inside the flight (`thumbnails.go:97-99`); render fork-bomb cap (`thumbnails.go:29-30,110-113`); atomic cache writes (`thumbnails.go:135-157`); cache-write failure degrades to serve-anyway (`thumbnails.go:120-123`).
- Raster: temp-file cleanup on all paths, bounded timeout, page-out-of-range mapped to a sentinel, PNG magic verified, orientation under-resolve retry (`raster/pdftoppm.go:64-131`).
- HTTP hygiene: CORS exact-match allowlist with `Vary: Origin` (`api/router.go:66-85`); RFC 6266 filename encoding (`api/documents.go:73-83`); upload/content/stamp body caps (`documents.go:29`, `content.go:26-27`, `stamp.go:28-29`); name length cap (`document/service.go:65-76`); width clamp on thumbnails (`api/thumbnails.go:36-39`); server timeouts + graceful shutdown (`cmd/server/main.go:62-70,105-118`).
- PDF safety: magic-bytes pre-check + full validation on every ingest path including client-edited content (`pdf/engine.go:43-51`, `document/content.go:24-26`); decompression-bomb limits (`engine.go:29-38`).
- Signing: key files 0600/dir 0700 atomically written (`sign/identity.go:75,96-127`); key-then-cert write order makes partial state detectable not regenerable (`identity.go:120-127`); cert/key match + expiry checked at load (`identity.go:173+`); trust-pool mutation confined to startup (`pdf/signatures.go:17-27`); signature status mapping is conservative (unverifiable digest → invalid, only trust problems → unknown, `signatures.go:108-124`); whole-document coverage computed from ByteRange vs EOF (`signatures.go:143-166`).
- Input validation breadth: page ops (`document/pageops.go:33-93`), annotations incl. color regex/opacity/font bounds (`annotations.go:47-107`), form-field caps (`formcreate.go:18-21`), insert caps + size whitelist (`pageinsert.go:10-16`), sign field caps + rect sanity (`sign.go:81-98`).
- Config: fail-fast on invalid env, paired-var check for signing files (`config/config.go:44-62`).

**Frontend** (subagent audit, citations spot-verified)
- Listener cleanup throughout (keyboard `EditorScreen.tsx:534-535`, toasts, kebab/viewer scroll-resize) — clean.
- pdf.js document `destroy()` on URL change/unmount (`pdf/hooks.ts:42-45`); mupdf worker terminated on `pagehide` (`pdf/mupdfWorkerClient.ts:40-44`) — clean.
- PDF buffers transferred (not copied) into the worker (`pdf/engineMupdf.ts:284-285`) — single resident copy.
- react-query invalidation complete after every mutation class (`EditorScreen.tsx:145-147,429-452`); signatures query keyed by headVersion (`api/useSignatures.ts:7-16`) — no stale windows beyond the 5 s staleTime (`main.tsx:16`).
- Errors never swallowed: fetch wrapper toasts + rethrows (`api/client.ts:45-62`); save failures preserve pending state for retry (`EditorScreen.tsx:205-207`).
- zustand store fully re-initialized on document switch (`editorStore.ts:140-152`, wired at `EditorScreen.tsx:134-137`).
- Download object-URL revoked after use (`api/documents.ts:236-243`).

---

## Dependency additions, consolidated

| Tier | New deps |
|---|---|
| 1 (now) | `prometheus/client_golang`; restic/rclone (host-side); none for locking/limits |
| 2 (growth) | Authelia **or** oauth2-proxy container; `modernc.org/sqlite`; ocrmypdf sidecar image (optional) |
| 3 (team) | minio container or S3 + `minio-go` (only if multi-host); Postgres only as part of a deliberate availability project |
