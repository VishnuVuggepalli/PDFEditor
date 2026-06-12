package pdf

import (
	"bytes"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// freeTextDict annotates the fixture with one text annotation and returns the
// raw FreeText annotation dict from the output, for dict-level assertions.
func freeTextDict(t *testing.T, a document.Annotation) types.Dict {
	t.Helper()
	e := NewEngine()
	out, err := e.Annotate(fixture(t), []document.Annotation{a})
	if err != nil {
		t.Fatalf("Annotate: %v", err)
	}
	ctx, err := api.ReadContext(bytes.NewReader(out), e.conf)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if err := api.ValidateContext(ctx); err != nil {
		t.Fatalf("validate output: %v", err)
	}
	pd, _, _, err := ctx.PageDict(a.Page, false)
	if err != nil {
		t.Fatalf("page dict: %v", err)
	}
	annots, err := ctx.DereferenceArray(pd["Annots"])
	if err != nil || len(annots) == 0 {
		t.Fatalf("page has no annots: %v", err)
	}
	for _, o := range annots {
		d, err := ctx.DereferenceDict(o)
		if err != nil {
			t.Fatalf("deref annot: %v", err)
		}
		if subtype := d.NameEntry("Subtype"); subtype != nil && *subtype == "FreeText" {
			return d
		}
	}
	t.Fatal("no FreeText annotation in output")
	return nil
}

func textAnnot() document.Annotation {
	return document.Annotation{
		Type: document.AnnText, Page: 1,
		Rect:  [4]float64{70, 560, 300, 600},
		Color: "#111827", Contents: "typed", FontSize: 14,
	}
}

// numVal extracts a numeric dict entry that may round-trip as Integer or Float.
func numVal(t *testing.T, o types.Object) float64 {
	t.Helper()
	switch v := o.(type) {
	case types.Integer:
		return float64(v)
	case types.Float:
		return float64(v)
	default:
		t.Fatalf("entry is not numeric: %T %v", o, o)
		return 0
	}
}

func TestFreeTextZeroBorderIsExplicit(t *testing.T) {
	d := freeTextDict(t, textAnnot())

	bs, ok := d["BS"].(types.Dict)
	if !ok {
		t.Fatalf("want explicit /BS dict, got %v", d["BS"])
	}
	if w := numVal(t, bs["W"]); w != 0 {
		t.Errorf("want /BS /W 0 (suppresses the PDF-spec default 1pt border), got %v", w)
	}
	if _, hasBorder := d["Border"]; hasBorder {
		t.Error("legacy /Border entry must be removed when /BS is explicit")
	}
}

func TestFreeTextPositiveBorderKept(t *testing.T) {
	a := textAnnot()
	a.BorderWidth = 2
	d := freeTextDict(t, a)

	bs, ok := d["BS"].(types.Dict)
	if !ok {
		t.Fatalf("want /BS dict, got %v", d["BS"])
	}
	if w := numVal(t, bs["W"]); w != 2 {
		t.Errorf("want /BS /W 2, got %v", w)
	}
}

func TestFreeTextFontInDA(t *testing.T) {
	tests := []struct {
		token    string
		wantName string
	}{
		{"", "Helvetica"},
		{"helvetica-bold", "Helvetica-Bold"},
		{"times", "Times-Roman"},
		{"times-bolditalic", "Times-BoldItalic"},
		{"courier-italic", "Courier-Oblique"},
	}
	for _, tt := range tests {
		t.Run("token_"+tt.token, func(t *testing.T) {
			a := textAnnot()
			a.Font = tt.token
			d := freeTextDict(t, a)

			da, ok := d["DA"].(types.StringLiteral)
			if !ok {
				t.Fatalf("missing /DA: %v", d["DA"])
			}
			if !strings.Contains(da.Value(), "/"+tt.wantName+" 14 Tf") {
				t.Errorf("DA %q does not select %s at size 14", da.Value(), tt.wantName)
			}
		})
	}
}

func TestFreeTextOutputValidates(t *testing.T) {
	e := NewEngine()
	a := textAnnot()
	a.Font = "times-bold"
	out, err := e.Annotate(fixture(t), []document.Annotation{a})
	if err != nil {
		t.Fatalf("Annotate: %v", err)
	}
	if err := e.Validate(out); err != nil {
		t.Fatalf("output invalid: %v", err)
	}
	if n := pageCount(t, e, out); n != 2 {
		t.Errorf("page count changed: %d", n)
	}
}
