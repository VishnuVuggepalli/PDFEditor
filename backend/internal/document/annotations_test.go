package document

import (
	"context"
	"errors"
	"testing"
)

func validHighlight() Annotation {
	return Annotation{
		Type:  AnnHighlight,
		Page:  1,
		Rect:  [4]float64{10, 10, 100, 30},
		Color: "#ffee00",
	}
}

func TestAnnotateValidation(t *testing.T) {
	ctx := context.Background()

	mod := func(fn func(*Annotation)) []Annotation {
		a := validHighlight()
		fn(&a)
		return []Annotation{a}
	}

	tests := []struct {
		name    string
		annots  []Annotation
		wantErr bool
	}{
		{"valid highlight", []Annotation{validHighlight()}, false},
		{"valid note", mod(func(a *Annotation) { a.Type = AnnNote; a.Contents = "hi" }), false},
		{"valid square", mod(func(a *Annotation) { a.Type = AnnSquare }), false},
		{"valid ink", mod(func(a *Annotation) {
			a.Type = AnnInk
			a.Paths = [][]float64{{10, 10, 20, 20, 30, 25}}
		}), false},
		{"valid opacity", mod(func(a *Annotation) { a.Opacity = 0.5 }), false},
		{"no annotations", nil, true},
		{"unknown type", mod(func(a *Annotation) { a.Type = "stamp" }), true},
		{"page zero", mod(func(a *Annotation) { a.Page = 0 }), true},
		{"page beyond count", mod(func(a *Annotation) { a.Page = 99 }), true},
		{"inverted rect", mod(func(a *Annotation) { a.Rect = [4]float64{100, 10, 10, 30} }), true},
		{"bad color", mod(func(a *Annotation) { a.Color = "yellow" }), true},
		{"short hex", mod(func(a *Annotation) { a.Color = "#ff0" }), true},
		{"opacity above 1", mod(func(a *Annotation) { a.Opacity = 1.5 }), true},
		{"ink without paths", mod(func(a *Annotation) { a.Type = AnnInk }), true},
		{"ink odd coords", mod(func(a *Annotation) {
			a.Type = AnnInk
			a.Paths = [][]float64{{10, 10, 20}}
		}), true},
		{"valid text", mod(func(a *Annotation) {
			a.Type = AnnText
			a.Contents = "hello"
			a.FontSize = 14
		}), false},
		{"valid text with bg and border", mod(func(a *Annotation) {
			a.Type = AnnText
			a.Contents = "hello"
			a.FontSize = 8
			a.Bg = "#ffffff"
			a.BorderWidth = 1.5
		}), false},
		{"text empty contents", mod(func(a *Annotation) {
			a.Type = AnnText
			a.FontSize = 14
		}), true},
		{"text font too small", mod(func(a *Annotation) {
			a.Type = AnnText
			a.Contents = "x"
			a.FontSize = 7
		}), true},
		{"text font too large", mod(func(a *Annotation) {
			a.Type = AnnText
			a.Contents = "x"
			a.FontSize = 73
		}), true},
		{"text bad bg", mod(func(a *Annotation) {
			a.Type = AnnText
			a.Contents = "x"
			a.FontSize = 12
			a.Bg = "white"
		}), true},
		{"valid circle", mod(func(a *Annotation) { a.Type = AnnCircle; a.BorderWidth = 2 }), false},
		{"circle border too wide", mod(func(a *Annotation) {
			a.Type = AnnCircle
			a.BorderWidth = 13
		}), true},
		{"negative border width", mod(func(a *Annotation) {
			a.Type = AnnSquare
			a.BorderWidth = -1
		}), true},
		{"valid line", mod(func(a *Annotation) {
			a.Type = AnnLine
			a.Line = []float64{10, 10, 100, 30}
		}), false},
		{"line missing endpoints", mod(func(a *Annotation) { a.Type = AnnLine }), true},
		{"line wrong coord count", mod(func(a *Annotation) {
			a.Type = AnnLine
			a.Line = []float64{10, 10, 100}
		}), true},
		{"line identical endpoints", mod(func(a *Annotation) {
			a.Type = AnnLine
			a.Line = []float64{10, 10, 10, 10}
		}), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _, _ := newPageOpsService(2)
			doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

			_, err := svc.Annotate(ctx, doc.ID, tt.annots)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidInput) {
					t.Errorf("want ErrInvalidInput, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Annotate: %v", err)
			}
		})
	}
}

func TestAnnotateCreatesVersion(t *testing.T) {
	ctx := context.Background()
	svc, _, eng := newPageOpsService(2)
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	updated, err := svc.Annotate(ctx, doc.ID, []Annotation{validHighlight(), validHighlight()})
	if err != nil {
		t.Fatalf("Annotate: %v", err)
	}
	if updated.HeadVersion != 2 {
		t.Errorf("want head=2, got %d", updated.HeadVersion)
	}
	if updated.Head().Ops != "2 annotation(s)" {
		t.Errorf("summary: %q", updated.Head().Ops)
	}
	if len(eng.applied) != 1 || eng.applied[0] != "annotate2" {
		t.Errorf("engine calls: %v", eng.applied)
	}
}

func TestFormFlow(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := newPageOpsService(1)
	doc, _ := svc.Upload(ctx, "form.pdf", validPDF)

	fields, err := svc.FormFields(ctx, doc.ID)
	if err != nil {
		t.Fatalf("FormFields: %v", err)
	}
	if len(fields) != 1 || fields[0].ID != "fullName" {
		t.Errorf("fields: %+v", fields)
	}

	updated, err := svc.FillForm(ctx, doc.ID, map[string]string{"fullName": "Vishnu"})
	if err != nil {
		t.Fatalf("FillForm: %v", err)
	}
	if updated.HeadVersion != 2 || updated.Head().Ops != "fill 1 form field(s)" {
		t.Errorf("version: head=%d ops=%q", updated.HeadVersion, updated.Head().Ops)
	}

	if _, err := svc.FillForm(ctx, doc.ID, nil); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("empty values: want ErrInvalidInput, got %v", err)
	}
	if _, err := svc.FillForm(ctx, doc.ID, map[string]string{"unknownField": "x"}); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("unknown field: want ErrInvalidInput, got %v", err)
	}
}
