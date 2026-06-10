package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func formFixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "form.pdf"))
	if err != nil {
		t.Fatalf("read form fixture: %v", err)
	}
	return b
}

func TestAnnotateEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t))) // 2 pages

	tests := []struct {
		name       string
		body       any
		wantStatus int
	}{
		{"valid highlight", map[string]any{
			"annotations": []map[string]any{{
				"type": "highlight", "page": 1,
				"rect": []float64{70, 700, 300, 730}, "color": "#ffee00",
			}},
		}, http.StatusOK},
		{"bad color", map[string]any{
			"annotations": []map[string]any{{
				"type": "highlight", "page": 1,
				"rect": []float64{70, 700, 300, 730}, "color": "yellow",
			}},
		}, http.StatusBadRequest},
		{"page out of range", map[string]any{
			"annotations": []map[string]any{{
				"type": "note", "page": 9,
				"rect": []float64{0, 0, 10, 10}, "color": "#000000",
			}},
		}, http.StatusBadRequest},
		{"empty list", map[string]any{"annotations": []map[string]any{}}, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := postJSON(t, r, "/api/v1/documents/"+id+"/annotations", tt.body)
			if rec.Code != tt.wantStatus {
				t.Errorf("want %d, got %d (%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestFormEndpoints(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "form.pdf", formFixture(t)))

	// List fields.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/form", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("form fields: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	fields := decode(t, rec).Data.([]any)
	if len(fields) != 2 {
		t.Fatalf("want 2 fields, got %d", len(fields))
	}

	// Fill by name.
	rec = postJSON(t, r, "/api/v1/documents/"+id+"/form", map[string]any{
		"values": map[string]string{"fullName": "Vishnu", "agree": "true"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("fill: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	// Unknown field rejected.
	rec = postJSON(t, r, "/api/v1/documents/"+id+"/form", map[string]any{
		"values": map[string]string{"ghost": "x"},
	})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("unknown field: want 400, got %d", rec.Code)
	}

	// Meta reports the form.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/meta", nil))
	m := decode(t, rec).Data.(map[string]any)
	if hasForm := m["pdf"].(map[string]any)["hasForm"].(bool); !hasForm {
		t.Error("meta should report hasForm=true")
	}
}
