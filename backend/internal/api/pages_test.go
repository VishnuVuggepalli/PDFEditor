package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func postJSON(t *testing.T, r *gin.Engine, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestPageOpsEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t))) // 2 pages

	tests := []struct {
		name       string
		body       any
		wantStatus int
	}{
		{"rotate page 1", map[string]any{
			"ops": []map[string]any{{"type": "rotate", "pages": []int{1}, "degrees": 90}},
		}, http.StatusOK},
		{"delete page 2", map[string]any{
			"ops": []map[string]any{{"type": "delete", "pages": []int{2}}},
		}, http.StatusOK},
		{"bad degrees", map[string]any{
			"ops": []map[string]any{{"type": "rotate", "pages": []int{1}, "degrees": 45}},
		}, http.StatusBadRequest},
		{"empty ops", map[string]any{"ops": []map[string]any{}}, http.StatusBadRequest},
		{"malformed json", "not json", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := postJSON(t, r, "/api/v1/documents/"+id+"/pages/ops", tt.body)
			if rec.Code != tt.wantStatus {
				t.Errorf("want %d, got %d (%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
		})
	}

	// After the two successful ops above, head must be v3 with 2 entries added.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/versions", nil))
	if vs := decode(t, rec).Data.([]any); len(vs) != 3 {
		t.Errorf("want 3 versions after 2 ops, got %d", len(vs))
	}
}

func TestMergeEndpoint(t *testing.T) {
	r := newTestServer(t)
	pdf := fixture(t)
	a := uploadedID(t, doUpload(t, r, "a.pdf", pdf))
	b := uploadedID(t, doUpload(t, r, "b.pdf", pdf))

	rec := postJSON(t, r, "/api/v1/documents/merge", map[string]any{
		"ids": []string{a, b}, "name": "merged.pdf",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("merge: want 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	mergedID := uploadedID(t, rec)

	// Merged doc has 4 pages (2+2), verified via meta.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+mergedID+"/meta", nil))
	m := decode(t, rec).Data.(map[string]any)
	if pc := m["pdf"].(map[string]any)["pageCount"].(float64); pc != 4 {
		t.Errorf("want 4 pages in merged doc, got %v", pc)
	}

	// Single source rejected.
	rec = postJSON(t, r, "/api/v1/documents/merge", map[string]any{
		"ids": []string{a}, "name": "x.pdf",
	})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("want 400 for single-source merge, got %d", rec.Code)
	}
}

func TestSplitEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t))) // 2 pages

	rec := postJSON(t, r, "/api/v1/documents/"+id+"/split", map[string]any{
		"ranges": []map[string]int{{"from": 1, "to": 1}, {"from": 2, "to": 2}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("split: want 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	parts := decode(t, rec).Data.([]any)
	if len(parts) != 2 {
		t.Fatalf("want 2 parts, got %d", len(parts))
	}
	name := parts[0].(map[string]any)["name"].(string)
	if name != "sample (p1-1).pdf" {
		t.Errorf("part name: %q", name)
	}

	// Out-of-range rejected.
	rec = postJSON(t, r, "/api/v1/documents/"+id+"/split", map[string]any{
		"ranges": []map[string]int{{"from": 1, "to": 99}},
	})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("want 400 for bad range, got %d", rec.Code)
	}
}
