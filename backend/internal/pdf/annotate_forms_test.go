package pdf

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

func formFixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "form.pdf"))
	if err != nil {
		t.Fatalf("read form fixture: %v", err)
	}
	return b
}

func TestAnnotateAllTypes(t *testing.T) {
	e := NewEngine()
	src := fixture(t) // 2 pages

	annots := []document.Annotation{
		{Type: document.AnnHighlight, Page: 1, Rect: [4]float64{70, 700, 300, 730}, Color: "#ffee00", Contents: "important"},
		{Type: document.AnnNote, Page: 1, Rect: [4]float64{320, 700, 340, 720}, Color: "#3366ff", Contents: "a note"},
		{Type: document.AnnSquare, Page: 2, Rect: [4]float64{50, 50, 200, 150}, Color: "#ff0000"},
		{Type: document.AnnInk, Page: 2, Rect: [4]float64{50, 200, 250, 300}, Color: "#00aa00",
			Paths: [][]float64{{60, 210, 120, 280, 240, 220}}},
		{Type: document.AnnHighlight, Page: 1, Rect: [4]float64{70, 650, 200, 670}, Color: "#88ff88", Opacity: 0.4},
		{Type: document.AnnText, Page: 1, Rect: [4]float64{70, 560, 300, 600}, Color: "#111827",
			Contents: "typed text", FontSize: 14},
		{Type: document.AnnText, Page: 2, Rect: [4]float64{70, 560, 300, 620}, Color: "#ff0000",
			Contents: "boxed text", FontSize: 24, Bg: "#ffffcc", BorderWidth: 1},
		{Type: document.AnnCircle, Page: 2, Rect: [4]float64{260, 50, 380, 150}, Color: "#2563eb", BorderWidth: 3},
		{Type: document.AnnLine, Page: 1, Rect: [4]float64{60, 490, 300, 530}, Color: "#16a34a",
			Line: []float64{65, 495, 295, 525}, BorderWidth: 2},
	}

	out, err := e.Annotate(src, annots)
	if err != nil {
		t.Fatalf("Annotate: %v", err)
	}
	if err := e.Validate(out); err != nil {
		t.Fatalf("annotated output invalid: %v", err)
	}
	if n := pageCount(t, e, out); n != 2 {
		t.Errorf("page count changed: %d", n)
	}
	if len(out) <= len(src) {
		t.Error("annotated PDF should be larger than source")
	}
}

func TestAnnotateGarbageFails(t *testing.T) {
	e := NewEngine()
	_, err := e.Annotate([]byte("%PDF-1.7 garbage"), []document.Annotation{
		{Type: document.AnnNote, Page: 1, Rect: [4]float64{0, 0, 10, 10}, Color: "#000000"},
	})
	if err == nil {
		t.Error("annotate on garbage should fail")
	}
}

func TestFormFieldsFixture(t *testing.T) {
	e := NewEngine()
	fields, err := e.FormFields(formFixture(t))
	if err != nil {
		t.Fatalf("FormFields: %v", err)
	}
	if len(fields) != 2 {
		t.Fatalf("want 2 fields, got %d: %+v", len(fields), fields)
	}

	// pdfcpu sets ID to the PDF object number; the stable key is Name.
	byName := map[string]document.FormField{}
	for _, f := range fields {
		byName[f.Name] = f
	}
	if f, ok := byName["fullName"]; !ok || f.Type != "text" {
		t.Errorf("fullName field wrong: %+v", f)
	}
	if f, ok := byName["agree"]; !ok || f.Type != "checkbox" {
		t.Errorf("agree field wrong: %+v", f)
	}
}

func TestFormFieldsOnPlainPDF(t *testing.T) {
	e := NewEngine()
	fields, err := e.FormFields(fixture(t))
	if err != nil {
		// pdfcpu may error on no-form PDFs; either empty list or error is fine,
		// but an error must not be a panic.
		return
	}
	if len(fields) != 0 {
		t.Errorf("plain PDF should have no fields, got %+v", fields)
	}
}

func TestFillFormRoundTrip(t *testing.T) {
	e := NewEngine()
	src := formFixture(t)

	out, err := e.FillForm(src, map[string]string{
		"fullName": "Vishnu Vuggepalli",
		"agree":    "true",
	})
	if err != nil {
		t.Fatalf("FillForm: %v", err)
	}
	if err := e.Validate(out); err != nil {
		t.Fatalf("filled output invalid: %v", err)
	}

	// Read back: values must round-trip.
	fields, err := e.FormFields(out)
	if err != nil {
		t.Fatalf("FormFields after fill: %v", err)
	}
	got := map[string]string{}
	for _, f := range fields {
		got[f.Name] = f.Value
	}
	if got["fullName"] != "Vishnu Vuggepalli" {
		t.Errorf("fullName: %q", got["fullName"])
	}
}

func TestFillFormUnknownField(t *testing.T) {
	e := NewEngine()
	_, err := e.FillForm(formFixture(t), map[string]string{"nope": "x"})
	if err == nil {
		t.Error("unknown field should fail")
	}
}

func TestFillFormOnPlainPDF(t *testing.T) {
	e := NewEngine()
	if _, err := e.FillForm(fixture(t), map[string]string{"x": "y"}); err == nil {
		t.Error("filling a form-less PDF should fail")
	}
}
