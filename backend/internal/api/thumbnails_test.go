package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/pdf"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/raster"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/store"
)

var pngMagic = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

// newThumbServer wires the real stack including the thumbnail service over a
// temp data dir, returning the router and the data dir for cache assertions.
func newThumbServer(t *testing.T) (*gin.Engine, string) {
	t.Helper()
	if _, err := exec.LookPath("pdftoppm"); err != nil {
		t.Skipf("pdftoppm not installed: %v", err)
	}
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	st, err := store.NewFSStore(dataDir)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	svc := document.NewService(st, pdf.NewEngine())
	h := NewHandlers(svc, 10<<20)
	h.SetThumbs(document.NewThumbService(svc, raster.New(), filepath.Join(dataDir, "documents")))
	return NewRouter(h), dataDir
}

func getThumb(r *gin.Engine, url string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	return rec
}

func TestThumbnailEndpoint(t *testing.T) {
	r, _ := newThumbServer(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t)))

	tests := []struct {
		name       string
		url        string
		wantStatus int
		wantPNG    bool
	}{
		{"defaults (page 1, width 240)", "/api/v1/documents/" + id + "/thumbnail", http.StatusOK, true},
		{"explicit page and width", "/api/v1/documents/" + id + "/thumbnail?page=2&width=100", http.StatusOK, true},
		{"width above cap is clamped", "/api/v1/documents/" + id + "/thumbnail?width=9999", http.StatusOK, true},
		{"page out of range", "/api/v1/documents/" + id + "/thumbnail?page=99", http.StatusNotFound, false},
		{"non-numeric page", "/api/v1/documents/" + id + "/thumbnail?page=abc", http.StatusBadRequest, false},
		{"zero page", "/api/v1/documents/" + id + "/thumbnail?page=0", http.StatusBadRequest, false},
		{"negative width", "/api/v1/documents/" + id + "/thumbnail?width=-5", http.StatusBadRequest, false},
		{"non-numeric width", "/api/v1/documents/" + id + "/thumbnail?width=big", http.StatusBadRequest, false},
		{"missing document", "/api/v1/documents/nope/thumbnail", http.StatusNotFound, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := getThumb(r, tt.url)
			if rec.Code != tt.wantStatus {
				t.Fatalf("status: want %d, got %d (body: %s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
			if tt.wantPNG {
				if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
					t.Errorf("content-type: want image/png, got %s", ct)
				}
				if !bytes.HasPrefix(rec.Body.Bytes(), pngMagic) {
					t.Error("body is not a PNG")
				}
				return
			}
			env := decode(t, rec)
			if env.Success || env.Error == "" {
				t.Errorf("error envelope malformed: %+v", env)
			}
		})
	}
}

func TestThumbnailCacheHit(t *testing.T) {
	r, dataDir := newThumbServer(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t)))

	// First call renders and populates the cache.
	if rec := getThumb(r, "/api/v1/documents/"+id+"/thumbnail?width=240"); rec.Code != http.StatusOK {
		t.Fatalf("first call: %d (%s)", rec.Code, rec.Body.String())
	}
	cached := filepath.Join(dataDir, "documents", id, "thumbs", "v1-p1-w240.png")
	if _, err := os.Stat(cached); err != nil {
		t.Fatalf("cache file missing after first call: %v", err)
	}

	// Plant sentinel bytes in the cache file; the second call must serve them
	// verbatim, proving it never re-shelled out to pdftoppm.
	sentinel := append(append([]byte{}, pngMagic...), []byte("sentinel")...)
	if err := os.WriteFile(cached, sentinel, 0o644); err != nil {
		t.Fatal(err)
	}
	rec := getThumb(r, "/api/v1/documents/"+id+"/thumbnail?width=240")
	if rec.Code != http.StatusOK {
		t.Fatalf("second call: %d", rec.Code)
	}
	if !bytes.Equal(rec.Body.Bytes(), sentinel) {
		t.Error("second call did not serve the cached bytes — cache miss")
	}
}

func TestThumbnailGoneAfterDelete(t *testing.T) {
	r, dataDir := newThumbServer(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t)))

	if rec := getThumb(r, "/api/v1/documents/"+id+"/thumbnail"); rec.Code != http.StatusOK {
		t.Fatalf("render: %d", rec.Code)
	}

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/v1/documents/"+id, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: %d", rec.Code)
	}

	// Whole doc dir (thumbs included) is gone, and the endpoint 404s.
	if _, err := os.Stat(filepath.Join(dataDir, "documents", id)); !os.IsNotExist(err) {
		t.Errorf("doc dir still present after delete: %v", err)
	}
	if rec := getThumb(r, "/api/v1/documents/"+id+"/thumbnail"); rec.Code != http.StatusNotFound {
		t.Errorf("want 404 after delete, got %d", rec.Code)
	}
}
