package pdf

import (
	"testing"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// fieldNames extracts the user-facing names (falling back to IDs) of fields.
func fieldNames(fields []document.FormField) map[string]document.FormField {
	out := make(map[string]document.FormField, len(fields))
	for _, f := range fields {
		key := f.Name
		if key == "" {
			key = f.ID
		}
		out[key] = f
	}
	return out
}

func TestAddFormFieldsToPlainPDF(t *testing.T) {
	e := NewEngine()
	src := fixture(t) // sample.pdf, 2 pages, no form

	out, err := e.AddFormFields(src, []document.NewFormField{
		{Type: "text", ID: "firstName", Label: "First name", Page: 1, Rect: [4]float64{100, 600, 300, 620}},
		{Type: "text", ID: "notes", Page: 2, Rect: [4]float64{100, 500, 400, 580}, Multiline: true},
		{Type: "checkbox", ID: "agree2", Page: 2, Rect: [4]float64{100, 460, 114, 474}, Default: "true"},
	})
	if err != nil {
		t.Fatalf("AddFormFields: %v", err)
	}
	if err := e.Validate(out); err != nil {
		t.Fatalf("output invalid: %v", err)
	}
	if n := pageCount(t, e, out); n != 2 {
		t.Errorf("page count changed: want 2, got %d", n)
	}

	fields, err := e.FormFields(out)
	if err != nil {
		t.Fatalf("FormFields: %v", err)
	}
	if len(fields) != 3 {
		t.Fatalf("want 3 fields, got %d (%+v)", len(fields), fields)
	}
	byName := fieldNames(fields)

	tests := []struct {
		name     string
		wantType string
		wantPage int
	}{
		{"firstName", "text", 1},
		{"notes", "text", 2},
		{"agree2", "checkbox", 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, ok := byName[tt.name]
			if !ok {
				t.Fatalf("field %q not found", tt.name)
			}
			if f.Type != tt.wantType {
				t.Errorf("type: want %q, got %q", tt.wantType, f.Type)
			}
			if len(f.Pages) != 1 || f.Pages[0] != tt.wantPage {
				t.Errorf("pages: want [%d], got %v", tt.wantPage, f.Pages)
			}
		})
	}
}

func TestAddFormFieldsThenFillRoundTrip(t *testing.T) {
	e := NewEngine()
	src := fixture(t) // 2 pages, no form

	withFields, err := e.AddFormFields(src, []document.NewFormField{
		{Type: "text", ID: "city", Page: 1, Rect: [4]float64{100, 600, 300, 620}},
		{Type: "checkbox", ID: "subscribed", Page: 1, Rect: [4]float64{100, 560, 114, 574}},
	})
	if err != nil {
		t.Fatalf("AddFormFields: %v", err)
	}

	filled, err := e.FillForm(withFields, map[string]string{
		"city":       "Hyderabad",
		"subscribed": "true",
	})
	if err != nil {
		t.Fatalf("FillForm on created fields: %v", err)
	}

	fields, err := e.FormFields(filled)
	if err != nil {
		t.Fatalf("FormFields after fill: %v", err)
	}
	byName := fieldNames(fields)
	if got := byName["city"].Value; got != "Hyderabad" {
		t.Errorf("city value: want %q, got %q", "Hyderabad", got)
	}
	if got := byName["subscribed"].Value; got != "Yes" && got != "true" && got != "On" {
		t.Errorf("subscribed value: want a checked state, got %q", got)
	}
}

func TestAddFormFieldsCoexistWithExisting(t *testing.T) {
	e := NewEngine()
	src := formFixture(t) // form.pdf: fullName (text) + agree (checkbox)

	out, err := e.AddFormFields(src, []document.NewFormField{
		{Type: "text", ID: "extraField", Page: 1, Rect: [4]float64{100, 400, 300, 420}},
	})
	if err != nil {
		t.Fatalf("AddFormFields: %v", err)
	}

	fields, err := e.FormFields(out)
	if err != nil {
		t.Fatalf("FormFields: %v", err)
	}
	if len(fields) != 3 {
		t.Fatalf("want 3 fields (2 existing + 1 new), got %d", len(fields))
	}
	byName := fieldNames(fields)
	for _, want := range []string{"fullName", "agree", "extraField"} {
		if _, ok := byName[want]; !ok {
			t.Errorf("field %q missing after add", want)
		}
	}

	// Existing and new fields are both still fillable.
	if _, err := e.FillForm(out, map[string]string{"fullName": "V", "extraField": "x"}); err != nil {
		t.Errorf("FillForm across old+new fields: %v", err)
	}
}

func TestAddFormFieldsDuplicateIDFails(t *testing.T) {
	e := NewEngine()
	src := formFixture(t) // already has "fullName"

	if _, err := e.AddFormFields(src, []document.NewFormField{
		{Type: "text", ID: "fullName", Page: 1, Rect: [4]float64{100, 400, 300, 420}},
	}); err == nil {
		t.Fatal("want error for duplicate field id, got nil")
	}
}

func TestAddFormFieldsDefaultValueShowsUp(t *testing.T) {
	e := NewEngine()
	src := fixture(t)

	out, err := e.AddFormFields(src, []document.NewFormField{
		{Type: "text", ID: "country", Page: 1, Rect: [4]float64{100, 600, 300, 620}, Default: "India"},
	})
	if err != nil {
		t.Fatalf("AddFormFields: %v", err)
	}
	fields, err := e.FormFields(out)
	if err != nil {
		t.Fatalf("FormFields: %v", err)
	}
	if got := fieldNames(fields)["country"].Value; got != "India" {
		t.Errorf("default value: want %q, got %q", "India", got)
	}
}
