package document

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"golang.org/x/sync/semaphore"
	"golang.org/x/sync/singleflight"
)

// Rasterizer is what the thumbnail service needs from a page renderer.
// Defined here, in the consumer package; implemented by internal/raster.
type Rasterizer interface {
	// PagePNG renders one 1-based page scaled to width pixels wide (height
	// proportional) and returns the PNG bytes.
	PagePNG(ctx context.Context, pdf []byte, page, width int) ([]byte, error)
}

// Thumbnail width limits, enforced here; the HTTP layer pre-clamps.
const (
	ThumbDefaultWidth = 240
	ThumbMaxWidth     = 1024
)

// maxConcurrentRenders caps how many rasterizer processes (pdftoppm) may run
// at once, so a burst of cache misses cannot fork-bomb the host.
const maxConcurrentRenders = 4

// ThumbService renders page thumbnails of a document's head version, caching
// the PNGs on disk inside the document's own directory:
//
//	{docsRoot}/{id}/thumbs/v{N}-p{page}-w{width}.png
//
// The head version number is part of the cache key, so saving a new version
// naturally invalidates stale thumbnails, and deleting a document removes its
// cache for free (the store RemoveAlls the whole document directory).
type ThumbService struct {
	svc      *Service
	raster   Rasterizer
	docsRoot string // mirrors the fs store layout: {dataDir}/documents

	// flight collapses concurrent identical requests (same id+version+page+
	// width) into a single render; sem bounds total concurrent renders.
	flight singleflight.Group
	sem    *semaphore.Weighted
}

// NewThumbService wires a ThumbService. docsRoot must be the same
// {dataDir}/documents directory the fs store writes to.
func NewThumbService(svc *Service, r Rasterizer, docsRoot string) *ThumbService {
	return &ThumbService{
		svc:      svc,
		raster:   r,
		docsRoot: docsRoot,
		sem:      semaphore.NewWeighted(maxConcurrentRenders),
	}
}

// Thumbnail returns the PNG of one page of the head version of document id,
// serving from the on-disk cache when present.
func (t *ThumbService) Thumbnail(ctx context.Context, id string, page, width int) ([]byte, error) {
	if page < 1 {
		return nil, fmt.Errorf("%w: page must be >= 1, got %d", ErrInvalidInput, page)
	}
	if width < 1 || width > ThumbMaxWidth {
		return nil, fmt.Errorf("%w: width must be 1..%d, got %d", ErrInvalidInput, ThumbMaxWidth, width)
	}

	pdf, doc, err := t.svc.Download(ctx, id)
	if err != nil {
		return nil, err
	}

	path := t.cachePath(id, doc.HeadVersion, page, width)
	if png, err := os.ReadFile(path); err == nil {
		return png, nil
	}

	// Collapse concurrent identical requests into one render. The key matches
	// the cache key, so every distinct thumbnail renders at most once.
	key := fmt.Sprintf("%s/v%d/p%d/w%d", id, doc.HeadVersion, page, width)
	v, err, _ := t.flight.Do(key, func() (any, error) {
		return t.render(ctx, id, path, pdf, page, width)
	})
	if err != nil {
		return nil, err
	}
	return v.([]byte), nil
}

// render rasterizes one page under the global concurrency cap and caches the
// result. It re-checks the disk cache first: a duplicate request that joined
// the flight after a previous flight finished must not re-render.
func (t *ThumbService) render(ctx context.Context, id, path string, pdf []byte, page, width int) ([]byte, error) {
	if png, err := os.ReadFile(path); err == nil {
		return png, nil
	}

	info, err := t.svc.engine.Info(pdf)
	if err != nil {
		return nil, fmt.Errorf("read pdf info for thumbnail: %w", err)
	}
	if page > info.PageCount {
		return nil, fmt.Errorf("%w: page %d of %s (document has %d)", ErrNotFound, page, id, info.PageCount)
	}

	if err := t.sem.Acquire(ctx, 1); err != nil {
		return nil, fmt.Errorf("wait for render slot: %w", err)
	}
	defer t.sem.Release(1)

	png, err := t.raster.PagePNG(ctx, pdf, page, width)
	if err != nil {
		return nil, fmt.Errorf("render thumbnail p%d w%d of %s: %w", page, width, id, err)
	}

	// A failed cache write must not fail the request; log and serve anyway.
	if err := writeFileAtomic(path, png); err != nil {
		slog.Warn("thumbnail cache write failed", "doc", id, "path", path, "err", err)
	}
	return png, nil
}

// cachePath builds the on-disk location of one cached thumbnail.
func (t *ThumbService) cachePath(id string, version, page, width int) string {
	return filepath.Join(t.docsRoot, id, "thumbs",
		fmt.Sprintf("v%d-p%d-w%d.png", version, page, width))
}

// writeFileAtomic writes via temp file + rename in the destination directory
// so a crash can never leave a torn cache file.
func writeFileAtomic(path string, b []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create cache dir: %w", err)
	}
	tmp, err := os.CreateTemp(dir, "thumb-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	defer os.Remove(tmp.Name()) // no-op after successful rename

	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}
