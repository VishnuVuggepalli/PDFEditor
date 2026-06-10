package api

import (
	"mime"
	"net/http"
	"net/http/httptest"
	"testing"
)

// newTestServer's allowlist is {"http://localhost:8880"}; see api_test.go.

func TestCORSAllowlist(t *testing.T) {
	r := newTestServer(t)

	tests := []struct {
		name      string
		method    string
		origin    string
		wantAllow string // expected Access-Control-Allow-Origin ("" = absent)
	}{
		{"allowlisted origin echoed", http.MethodGet, "http://localhost:8880", "http://localhost:8880"},
		{"unlisted origin gets no CORS", http.MethodGet, "http://evil.example", ""},
		{"no origin header", http.MethodGet, "", ""},
		{"preflight allowlisted", http.MethodOptions, "http://localhost:8880", "http://localhost:8880"},
		{"preflight unlisted", http.MethodOptions, "http://evil.example", ""},
		{"wildcard is never emitted", http.MethodGet, "*", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/healthz", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != tt.wantAllow {
				t.Errorf("Allow-Origin: want %q, got %q", tt.wantAllow, got)
			}
			if got := rec.Header().Get("Vary"); got != "Origin" {
				t.Errorf("Vary: want %q, got %q", "Origin", got)
			}
			if tt.method == http.MethodOptions {
				if rec.Code != http.StatusNoContent {
					t.Errorf("preflight status: want 204, got %d", rec.Code)
				}
				wantMethods := tt.wantAllow != ""
				if got := rec.Header().Get("Access-Control-Allow-Methods"); (got != "") != wantMethods {
					t.Errorf("Allow-Methods presence: want %v, got %q", wantMethods, got)
				}
			}
		})
	}
}

func TestDownloadContentDisposition(t *testing.T) {
	r := newTestServer(t)
	valid := fixture(t)

	tests := []struct {
		name     string
		filename string
	}{
		{"ascii name", "report.pdf"},
		{"name with spaces and quotes", `annual "final" report.pdf`},
		{"non-ascii name", "résumé-übersicht.pdf"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id := uploadedID(t, doUpload(t, r, tt.filename, valid))

			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("download: want 200, got %d", rec.Code)
			}

			// The header must round-trip through a standards-compliant parser
			// (RFC 6266/5987): disposition intact, filename decoded exactly.
			cd := rec.Header().Get("Content-Disposition")
			disp, params, err := mime.ParseMediaType(cd)
			if err != nil {
				t.Fatalf("unparseable Content-Disposition %q: %v", cd, err)
			}
			if disp != "inline" {
				t.Errorf("disposition: want inline, got %q", disp)
			}
			if params["filename"] != tt.filename {
				t.Errorf("filename: want %q, got %q (header %q)", tt.filename, params["filename"], cd)
			}
		})
	}
}
