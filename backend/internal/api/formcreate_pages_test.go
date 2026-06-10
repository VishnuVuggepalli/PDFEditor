package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// docPageCount reads the live page count via the meta endpoint.
func docPageCount(t *testing.T, r http.Handler, id string) int {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/meta", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("meta: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	m := decode(t, rec).Data.(map[string]any)
	return int(m["pdf"].(map[string]any)["pageCount"].(float64))
}

func TestAddFormFieldsEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t))) // 2 pages, no form

	tests := []struct {
		name       string
		body       any
		wantStatus int
	}{
		{"valid text + checkbox", map[string]any{
			"fields": []map[string]any{
				{"type": "text", "id": "firstName", "label": "First name", "page": 1,
					"rect": []float64{100, 600, 300, 620}},
				{"type": "checkbox", "id": "agree", "page": 2,
					"rect": []float64{100, 560, 114, 574}, "default": "true"},
			},
		}, http.StatusOK},
		{"duplicate of just-created field", map[string]any{
			"fields": []map[string]any{
				{"type": "text", "id": "firstName", "page": 1, "rect": []float64{10, 10, 110, 30}},
			},
		}, http.StatusBadRequest},
		{"unknown type", map[string]any{
			"fields": []map[string]any{
				{"type": "radio", "id": "x", "page": 1, "rect": []float64{10, 10, 110, 30}},
			},
		}, http.StatusBadRequest},
		{"page out of range", map[string]any{
			"fields": []map[string]any{
				{"type": "text", "id": "y", "page": 9, "rect": []float64{10, 10, 110, 30}},
			},
		}, http.StatusBadRequest},
		{"inverted rect", map[string]any{
			"fields": []map[string]any{
				{"type": "text", "id": "z", "page": 1, "rect": []float64{110, 10, 10, 30}},
			},
		}, http.StatusBadRequest},
		{"empty list", map[string]any{"fields": []map[string]any{}}, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := postJSON(t, r, "/api/v1/documents/"+id+"/form/fields", tt.body)
			if rec.Code != tt.wantStatus {
				t.Errorf("want %d, got %d (%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
		})
	}

	// The created fields are listed by the form endpoint…
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/form", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("form list: want 200, got %d", rec.Code)
	}
	if fields := decode(t, rec).Data.([]any); len(fields) != 2 {
		t.Fatalf("want 2 fields after create, got %d", len(fields))
	}

	// …and are fillable like any pre-existing form.
	rec = postJSON(t, r, "/api/v1/documents/"+id+"/form", map[string]any{
		"values": map[string]string{"firstName": "Vishnu", "agree": "false"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("fill created fields: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	// Adding to a document that already has fields keeps both sets.
	rec = postJSON(t, r, "/api/v1/documents/"+id+"/form/fields", map[string]any{
		"fields": []map[string]any{
			{"type": "text", "id": "lastName", "page": 1, "rect": []float64{100, 560, 300, 580}},
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("second add: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+id+"/form", nil))
	if fields := decode(t, rec).Data.([]any); len(fields) != 3 {
		t.Fatalf("want 3 fields after second add, got %d", len(fields))
	}
}

func TestInsertPagesEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t))) // 2 pages

	tests := []struct {
		name       string
		body       any
		wantStatus int
		wantPages  int // asserted only on success, cumulative
	}{
		{"insert at 2", map[string]any{"at": 2}, http.StatusOK, 3},
		{"append at end", map[string]any{"at": 4, "count": 2}, http.StatusOK, 5},
		{"explicit size", map[string]any{"at": 1, "size": "Letter"}, http.StatusOK, 6},
		{"at zero", map[string]any{"at": 0}, http.StatusBadRequest, 0},
		{"beyond end+1", map[string]any{"at": 99}, http.StatusBadRequest, 0},
		{"bad size", map[string]any{"at": 1, "size": "Banana"}, http.StatusBadRequest, 0},
		{"count over cap", map[string]any{"at": 1, "count": 999}, http.StatusBadRequest, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := postJSON(t, r, "/api/v1/documents/"+id+"/pages/insert", tt.body)
			if rec.Code != tt.wantStatus {
				t.Fatalf("want %d, got %d (%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
			if tt.wantStatus == http.StatusOK {
				if n := docPageCount(t, r, id); n != tt.wantPages {
					t.Errorf("want %d pages, got %d", tt.wantPages, n)
				}
			}
		})
	}
}

func TestAppendFromEndpoint(t *testing.T) {
	r := newTestServer(t)
	dst := uploadedID(t, doUpload(t, r, "sample.pdf", fixture(t)))   // 2 pages
	src := uploadedID(t, doUpload(t, r, "form.pdf", formFixture(t))) // 1 page

	// Append the whole source document.
	rec := postJSON(t, r, "/api/v1/documents/"+dst+"/pages/append-from", map[string]any{
		"sourceId": src,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("append all: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if n := docPageCount(t, r, dst); n != 3 {
		t.Errorf("after append all: want 3 pages, got %d", n)
	}

	// Append a page selection (page 1 of the source).
	rec = postJSON(t, r, "/api/v1/documents/"+dst+"/pages/append-from", map[string]any{
		"sourceId": src, "pages": []int{1},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("append selection: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if n := docPageCount(t, r, dst); n != 4 {
		t.Errorf("after append selection: want 4 pages, got %d", n)
	}

	// The source document is untouched.
	if n := docPageCount(t, r, src); n != 1 {
		t.Errorf("source mutated: want 1 page, got %d", n)
	}

	// Failure modes.
	for _, tt := range []struct {
		name       string
		body       any
		wantStatus int
	}{
		{"unknown source", map[string]any{"sourceId": "ghost"}, http.StatusNotFound},
		{"missing sourceId", map[string]any{}, http.StatusBadRequest},
		{"source page out of range", map[string]any{"sourceId": src, "pages": []int{9}}, http.StatusBadRequest},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rec := postJSON(t, r, "/api/v1/documents/"+dst+"/pages/append-from", tt.body)
			if rec.Code != tt.wantStatus {
				t.Errorf("want %d, got %d (%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
		})
	}
}
