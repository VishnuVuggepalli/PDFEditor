package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/pdf"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/store"
)

// newTestServer wires the real stack (fs store + pdfcpu engine) over a temp
// dir — integration-style API tests.
func newTestServer(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	st, err := store.NewFSStore(t.TempDir())
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	svc := document.NewService(st, pdf.NewEngine())
	return NewRouter(NewHandlers(svc, 10<<20), []string{"http://localhost:8880"})
}

func fixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "sample.pdf"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return b
}

// multipartBody builds a multipart request body with a single "file" field.
func multipartBody(t *testing.T, filename string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(data); err != nil {
		t.Fatal(err)
	}
	w.Close()
	return &buf, w.FormDataContentType()
}

func doUpload(t *testing.T, r *gin.Engine, filename string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	body, ctype := multipartBody(t, filename, data)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", body)
	req.Header.Set("Content-Type", ctype)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) Envelope {
	t.Helper()
	var env Envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v (body: %s)", err, rec.Body.String())
	}
	return env
}

func uploadedID(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	env := decode(t, rec)
	m, ok := env.Data.(map[string]any)
	if !ok {
		t.Fatalf("data not an object: %v", env.Data)
	}
	return m["id"].(string)
}

func TestUploadEndpoint(t *testing.T) {
	r := newTestServer(t)
	valid := fixture(t)

	tests := []struct {
		name       string
		data       []byte
		wantStatus int
		wantOK     bool
	}{
		{"valid pdf", valid, http.StatusCreated, true},
		{"not a pdf", []byte("plain text"), http.StatusUnprocessableEntity, false},
		{"empty file", nil, http.StatusUnprocessableEntity, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := doUpload(t, r, "test.pdf", tt.data)
			if rec.Code != tt.wantStatus {
				t.Errorf("status: want %d, got %d (body: %s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
			env := decode(t, rec)
			if env.Success != tt.wantOK {
				t.Errorf("success: want %v, got %v", tt.wantOK, env.Success)
			}
			if !tt.wantOK && env.Error == "" {
				t.Error("error message missing on failure")
			}
		})
	}
}

func TestUploadMissingFileField(t *testing.T) {
	r := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewBufferString("nope"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", rec.Code)
	}
}

func TestListDownloadMeta(t *testing.T) {
	r := newTestServer(t)
	valid := fixture(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", valid))

	// List
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d", rec.Code)
	}

	// Download head
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id, nil))
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), valid) {
		t.Errorf("download: status %d, bytes match=%v", rec.Code, bytes.Equal(rec.Body.Bytes(), valid))
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("content-type: %s", ct)
	}

	// Meta: page count comes from pdfcpu, fixture has 2 pages
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/meta", nil))
	env := decode(t, rec)
	m := env.Data.(map[string]any)
	if pc := m["pdf"].(map[string]any)["pageCount"].(float64); pc != 2 {
		t.Errorf("want pageCount=2, got %v", pc)
	}

	// 404 path
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("missing doc: want 404, got %d", rec.Code)
	}
}

func TestVersionEndpoints(t *testing.T) {
	r := newTestServer(t)
	valid := fixture(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", valid))

	// Restore v1 → creates v2 identical to v1.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/documents/"+id+"/versions/1/restore", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	// Versions list now has 2 entries.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/versions", nil))
	env := decode(t, rec)
	if vs := env.Data.([]any); len(vs) != 2 {
		t.Errorf("want 2 versions, got %d", len(vs))
	}

	// Specific version download.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/versions/2", nil))
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), valid) {
		t.Errorf("version download failed: %d", rec.Code)
	}

	// Bad version number.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/versions/abc", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("want 400 for non-numeric version, got %d", rec.Code)
	}
}
