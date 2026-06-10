package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// growHistory adds one version via the restore endpoint.
func growHistory(t *testing.T, r *gin.Engine, id string, n string) {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost,
		"/api/v1/documents/"+id+"/versions/"+n+"/restore", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("restore v%s: status %d (body: %s)", n, rec.Code, rec.Body.String())
	}
}

func TestDeleteVersionEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "a.pdf", fixture(t)))
	growHistory(t, r, id, "1") // v2
	growHistory(t, r, id, "1") // v3 (head)

	tests := []struct {
		name       string
		id         string
		n          string
		wantStatus int
	}{
		{"v1 is undeletable", id, "1", http.StatusBadRequest},
		{"head is undeletable", id, "3", http.StatusBadRequest},
		{"non-numeric version", id, "x", http.StatusBadRequest},
		{"missing version", id, "9", http.StatusNotFound},
		{"missing doc", "nope", "2", http.StatusNotFound},
		{"valid delete", id, "2", http.StatusOK},
		{"already deleted", id, "2", http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodDelete,
				"/api/v1/documents/"+tt.id+"/versions/"+tt.n, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tt.wantStatus {
				t.Errorf("status: want %d, got %d (body: %s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
			env := decode(t, rec)
			if (rec.Code == http.StatusOK) != env.Success {
				t.Errorf("envelope success mismatch: %+v", env)
			}
		})
	}
}

func TestDeleteVersionEndpointEffects(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "a.pdf", fixture(t)))
	growHistory(t, r, id, "1") // v2
	growHistory(t, r, id, "1") // v3 (head)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/v1/documents/"+id+"/versions/2", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("delete v2: status %d (body: %s)", rec.Code, rec.Body.String())
	}

	// The version list no longer contains v2 and keeps the gap (1, 3).
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/versions", nil))
	var env struct {
		Data []struct {
			N int `json:"n"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode versions: %v", err)
	}
	var ns []int
	for _, v := range env.Data {
		ns = append(ns, v.N)
	}
	if len(ns) != 2 || ns[0] != 1 || ns[1] != 3 {
		t.Errorf("want versions [1 3], got %v", ns)
	}

	// Downloading the deleted version 404s; the survivor still streams.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/versions/2", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("download deleted v2: want 404, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/versions/3", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("download v3: want 200, got %d", rec.Code)
	}

	// Restore across the gap still works and creates v4.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/documents/"+id+"/versions/3/restore", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("restore v3 across gap: want 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}
