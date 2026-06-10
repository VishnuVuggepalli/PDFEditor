package document

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeRaster returns canned PNG-ish bytes and counts invocations (atomically,
// so concurrency tests stay race-free) so cache behavior is observable. It
// also tracks the peak number of in-flight renders for semaphore tests.
type fakeRaster struct {
	calls       atomic.Int64
	inFlight    atomic.Int64
	maxInFlight atomic.Int64
	delay       time.Duration // optional: hold each render open
	fail        bool
}

func (f *fakeRaster) PagePNG(_ context.Context, pdf []byte, page, width int) ([]byte, error) {
	cur := f.inFlight.Add(1)
	defer f.inFlight.Add(-1)
	for {
		max := f.maxInFlight.Load()
		if cur <= max || f.maxInFlight.CompareAndSwap(max, cur) {
			break
		}
	}
	f.calls.Add(1)
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if f.fail {
		return nil, errors.New("boom")
	}
	return fmt.Appendf(nil, "png-p%d-w%d", page, width), nil
}

func newThumbFixture(t *testing.T) (*ThumbService, *fakeRaster, *fakeStore, string) {
	t.Helper()
	st := newFakeStore()
	svc := NewService(st, &fakeEngine{info: PDFInfo{PageCount: 3}})
	r := &fakeRaster{}
	root := t.TempDir()
	return NewThumbService(svc, r, root), r, st, root
}

func TestThumbnailValidation(t *testing.T) {
	ts, _, _, _ := newThumbFixture(t)
	ctx := context.Background()

	tests := []struct {
		name    string
		id      string
		page    int
		width   int
		wantErr error
	}{
		{"zero page", "doc-1", 0, 240, ErrInvalidInput},
		{"negative page", "doc-1", -3, 240, ErrInvalidInput},
		{"zero width", "doc-1", 1, 0, ErrInvalidInput},
		{"width over cap", "doc-1", 1, ThumbMaxWidth + 1, ErrInvalidInput},
		{"missing document", "nope", 1, 240, ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ts.Thumbnail(ctx, tt.id, tt.page, tt.width)
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("want %v, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestThumbnailPageBeyondCount(t *testing.T) {
	ts, r, _, _ := newThumbFixture(t)
	ctx := context.Background()
	doc, err := ts.svc.Upload(ctx, "a.pdf", validPDF)
	if err != nil {
		t.Fatal(err)
	}
	// fakeEngine reports 3 pages.
	if _, err := ts.Thumbnail(ctx, doc.ID, 4, 240); !errors.Is(err, ErrNotFound) {
		t.Errorf("want ErrNotFound for page 4 of 3, got %v", err)
	}
	if r.calls.Load() != 0 {
		t.Errorf("rasterizer must not run for out-of-range page; ran %d times", r.calls.Load())
	}
}

func TestThumbnailCache(t *testing.T) {
	ts, r, _, root := newThumbFixture(t)
	ctx := context.Background()
	doc, err := ts.svc.Upload(ctx, "a.pdf", validPDF)
	if err != nil {
		t.Fatal(err)
	}

	// First call renders and writes the cache file.
	png1, err := ts.Thumbnail(ctx, doc.ID, 1, 240)
	if err != nil {
		t.Fatalf("first render: %v", err)
	}
	if r.calls.Load() != 1 {
		t.Fatalf("want 1 raster call, got %d", r.calls.Load())
	}
	cached := filepath.Join(root, doc.ID, "thumbs", "v1-p1-w240.png")
	if _, err := os.Stat(cached); err != nil {
		t.Fatalf("cache file missing: %v", err)
	}

	// Second call is a cache hit: same bytes, no extra raster call.
	png2, err := ts.Thumbnail(ctx, doc.ID, 1, 240)
	if err != nil {
		t.Fatalf("cache hit: %v", err)
	}
	if r.calls.Load() != 1 {
		t.Errorf("cache hit re-rendered: %d calls", r.calls.Load())
	}
	if string(png1) != string(png2) {
		t.Errorf("cache returned different bytes: %q vs %q", png1, png2)
	}

	// A different width is a different cache key.
	if _, err := ts.Thumbnail(ctx, doc.ID, 1, 64); err != nil {
		t.Fatalf("second width: %v", err)
	}
	if r.calls.Load() != 2 {
		t.Errorf("want 2 raster calls after new width, got %d", r.calls.Load())
	}

	// A new head version invalidates: the v2 key forces a fresh render.
	if _, err := ts.svc.RestoreVersion(ctx, doc.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := ts.Thumbnail(ctx, doc.ID, 1, 240); err != nil {
		t.Fatalf("post-version render: %v", err)
	}
	if r.calls.Load() != 3 {
		t.Errorf("want 3 raster calls after new version, got %d", r.calls.Load())
	}
	if _, err := os.Stat(filepath.Join(root, doc.ID, "thumbs", "v2-p1-w240.png")); err != nil {
		t.Errorf("v2 cache file missing: %v", err)
	}
}

// TestThumbnailConcurrentDedupe proves singleflight collapses a burst of
// identical requests (same id+version+page+width) into a single render.
func TestThumbnailConcurrentDedupe(t *testing.T) {
	ts, r, _, _ := newThumbFixture(t)
	r.delay = 20 * time.Millisecond // hold the render open so callers overlap
	ctx := context.Background()
	doc, err := ts.svc.Upload(ctx, "a.pdf", validPDF)
	if err != nil {
		t.Fatal(err)
	}

	const callers = 8
	results := make([][]byte, callers)
	errs := make([]error, callers)
	var wg sync.WaitGroup
	for i := range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = ts.Thumbnail(ctx, doc.ID, 1, 240)
		}()
	}
	wg.Wait()

	for i := range callers {
		if errs[i] != nil {
			t.Fatalf("caller %d: %v", i, errs[i])
		}
		if string(results[i]) != string(results[0]) {
			t.Errorf("caller %d got different bytes: %q vs %q", i, results[i], results[0])
		}
	}
	if got := r.calls.Load(); got != 1 {
		t.Errorf("want exactly 1 raster call for identical concurrent requests, got %d", got)
	}
}

// TestThumbnailConcurrencyCap proves the semaphore never lets more than
// maxConcurrentRenders rasterizer processes run at once, even when many
// distinct thumbnails are requested together.
func TestThumbnailConcurrencyCap(t *testing.T) {
	ts, r, _, _ := newThumbFixture(t)
	r.delay = 20 * time.Millisecond
	ctx := context.Background()
	doc, err := ts.svc.Upload(ctx, "a.pdf", validPDF)
	if err != nil {
		t.Fatal(err)
	}

	const renders = 12 // distinct widths → distinct singleflight keys
	var wg sync.WaitGroup
	errs := make([]error, renders)
	for i := range renders {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = ts.Thumbnail(ctx, doc.ID, 1, 100+i)
		}()
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("render %d: %v", i, err)
		}
	}
	if got := r.calls.Load(); got != renders {
		t.Errorf("want %d raster calls (distinct keys), got %d", renders, got)
	}
	if peak := r.maxInFlight.Load(); peak > maxConcurrentRenders {
		t.Errorf("semaphore breached: %d concurrent renders (cap %d)", peak, maxConcurrentRenders)
	}
}

func TestThumbnailRasterFailure(t *testing.T) {
	ts, r, _, _ := newThumbFixture(t)
	r.fail = true
	ctx := context.Background()
	doc, err := ts.svc.Upload(ctx, "a.pdf", validPDF)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ts.Thumbnail(ctx, doc.ID, 1, 240); err == nil {
		t.Fatal("want error when rasterizer fails")
	}
}
