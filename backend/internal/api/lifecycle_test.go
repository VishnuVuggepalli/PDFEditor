package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRenameEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "old.pdf", fixture(t)))

	tests := []struct {
		name       string
		id         string
		body       string
		wantStatus int
	}{
		{"valid rename", id, `{"name":"new.pdf"}`, http.StatusOK},
		{"empty name", id, `{"name":""}`, http.StatusBadRequest},
		{"bad json", id, `{`, http.StatusBadRequest},
		{"missing doc", "nope", `{"name":"x.pdf"}`, http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch, "/api/v1/documents/"+tt.id, bytes.NewBufferString(tt.body))
			req.Header.Set("Content-Type", "application/json")
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

	// Name visible on subsequent GET meta.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/meta", nil))
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"new.pdf"`)) {
		t.Errorf("renamed name not in meta: %s", rec.Body.String())
	}
}

func TestDeleteEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "doomed.pdf", fixture(t)))

	tests := []struct {
		name       string
		id         string
		wantStatus int
	}{
		{"valid delete", id, http.StatusOK},
		{"already deleted", id, http.StatusNotFound},
		{"missing doc", "nope", http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodDelete, "/api/v1/documents/"+tt.id, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tt.wantStatus {
				t.Errorf("status: want %d, got %d (body: %s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
		})
	}

	// Download of a deleted document 404s.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id, nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("want 404 after delete, got %d", rec.Code)
	}
}
