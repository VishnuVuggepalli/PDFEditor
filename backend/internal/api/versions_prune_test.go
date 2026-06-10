package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/pdf"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/store"
)

// newPruningTestServer wires the real stack with a keep-last-N retention
// policy so the version endpoints are exercised against gapped histories.
func newPruningTestServer(t *testing.T, maxVersions int) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	st, err := store.NewFSStore(t.TempDir(), store.WithMaxVersions(maxVersions))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	svc := document.NewService(st, pdf.NewEngine())
	return NewRouter(NewHandlers(svc, 10<<20), []string{"http://localhost:8880"})
}

// doRestoreN POSTs /versions/{n}/restore and returns the recorder.
func doRestoreN(t *testing.T, r *gin.Engine, id string, n int) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	url := fmt.Sprintf("/api/v1/documents/%s/versions/%d/restore", id, n)
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, url, nil))
	return rec
}

func TestVersionEndpointsWithGappedHistory(t *testing.T) {
	r := newPruningTestServer(t, 3)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t)))

	// Each restore appends a new head; with max=3 the oldest non-v1,
	// non-head versions are pruned, leaving gaps: after four restores the
	// history is v1, v4, v5.
	for i, n := range []int{1, 1, 1, 3} {
		if rec := doRestoreN(t, r, id, n); rec.Code != http.StatusOK {
			t.Fatalf("restore #%d (v%d): want 200, got %d (%s)", i+1, n, rec.Code, rec.Body.String())
		}
	}

	// Version list shows the gapped survivors, in order.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/versions", nil))
	env := decode(t, rec)
	vs := env.Data.([]any)
	got := make([]float64, 0, len(vs))
	for _, v := range vs {
		got = append(got, v.(map[string]any)["n"].(float64))
	}
	want := []float64{1, 4, 5}
	if len(got) != len(want) {
		t.Fatalf("versions list: want %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("versions list: want %v, got %v", want, got)
		}
	}

	// Per-version endpoints are existence-based, not range-based.
	tests := []struct {
		name       string
		method     string
		url        string
		wantStatus int
	}{
		{"download pruned version", http.MethodGet, "/versions/2", http.StatusNotFound},
		{"download pruned middle version", http.MethodGet, "/versions/3", http.StatusNotFound},
		{"download surviving old version", http.MethodGet, "/versions/4", http.StatusOK},
		{"download v1", http.MethodGet, "/versions/1", http.StatusOK},
		{"restore pruned version", http.MethodPost, "/versions/2/restore", http.StatusNotFound},
		{"restore surviving version", http.MethodPost, "/versions/4/restore", http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, httptest.NewRequest(tt.method, "/api/v1/documents/"+id+tt.url, nil))
			if rec.Code != tt.wantStatus {
				t.Errorf("status: want %d, got %d (body: %s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
		})
	}
}
