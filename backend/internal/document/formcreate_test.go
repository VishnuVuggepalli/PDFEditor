package document

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func validField() NewFormField {
	return NewFormField{Type: FieldText, ID: "name", Page: 1, Rect: [4]float64{10, 10, 110, 30}}
}

func TestValidateNewFormField(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*NewFormField)
		taken   map[string]bool
		wantErr bool
	}{
		{"valid text", func(f *NewFormField) {}, nil, false},
		{"valid checkbox", func(f *NewFormField) { f.Type = FieldCheckbox; f.Default = "true" }, nil, false},
		{"valid multiline text", func(f *NewFormField) { f.Multiline = true }, nil, false},
		{"unknown type", func(f *NewFormField) { f.Type = "radio" }, nil, true},
		{"empty id", func(f *NewFormField) { f.ID = "" }, nil, true},
		{"dotted id", func(f *NewFormField) { f.ID = "a.b" }, nil, true},
		{"control char id", func(f *NewFormField) { f.ID = "a\nb" }, nil, true},
		{"oversized id", func(f *NewFormField) { f.ID = strings.Repeat("x", maxFieldIDBytes+1) }, nil, true},
		{"taken id", func(f *NewFormField) {}, map[string]bool{"name": true}, true},
		{"page zero", func(f *NewFormField) { f.Page = 0 }, nil, true},
		{"page out of range", func(f *NewFormField) { f.Page = 4 }, nil, true},
		{"inverted rect x", func(f *NewFormField) { f.Rect = [4]float64{110, 10, 10, 30} }, nil, true},
		{"inverted rect y", func(f *NewFormField) { f.Rect = [4]float64{10, 30, 110, 10} }, nil, true},
		{"empty rect", func(f *NewFormField) { f.Rect = [4]float64{10, 10, 10, 10} }, nil, true},
		{"oversized label", func(f *NewFormField) { f.Label = strings.Repeat("x", maxFieldLabelBytes+1) }, nil, true},
		{"oversized default", func(f *NewFormField) { f.Default = strings.Repeat("x", maxFieldDefaultBytes+1) }, nil, true},
		{"multiline checkbox", func(f *NewFormField) { f.Type = FieldCheckbox; f.Multiline = true }, nil, true},
		{"checkbox bad default", func(f *NewFormField) { f.Type = FieldCheckbox; f.Default = "maybe" }, nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := validField()
			tt.mutate(&f)
			taken := tt.taken
			if taken == nil {
				taken = map[string]bool{}
			}
			err := validateNewFormField(f, 3, taken)
			if tt.wantErr && err == nil {
				t.Fatal("want error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("want nil, got %v", err)
			}
			if tt.wantErr && !errors.Is(err, ErrInvalidInput) {
				t.Errorf("error should wrap ErrInvalidInput, got %v", err)
			}
		})
	}
}

func TestAddFormFieldsService(t *testing.T) {
	ctx := context.Background()
	svc, st := newTestService() // fakeEngine: 3 pages, HasForm=false
	doc, err := svc.Upload(ctx, "a.pdf", validPDF)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}

	out, err := svc.AddFormFields(ctx, doc.ID, []NewFormField{
		validField(),
		{Type: FieldCheckbox, ID: "agree", Page: 2, Rect: [4]float64{10, 10, 24, 24}},
	})
	if err != nil {
		t.Fatalf("AddFormFields: %v", err)
	}
	if out.HeadVersion != 2 {
		t.Errorf("want head v2, got v%d", out.HeadVersion)
	}
	if got := out.Versions[1].Ops; got != "add 2 form field(s)" {
		t.Errorf("ops summary: got %q", got)
	}
	_ = st
}

func TestAddFormFieldsRejectsBatchDuplicates(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService()
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	_, err := svc.AddFormFields(ctx, doc.ID, []NewFormField{validField(), validField()})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("want ErrInvalidInput for duplicate ids in one batch, got %v", err)
	}
}

func TestAddFormFieldsRejectsExistingName(t *testing.T) {
	ctx := context.Background()
	// fakeEngine reports an existing field "fullName" when HasForm is set.
	st := newFakeStore()
	svc := NewService(st, &fakeEngine{info: PDFInfo{PageCount: 3, HasForm: true}})
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	f := validField()
	f.ID = "fullName"
	_, err := svc.AddFormFields(ctx, doc.ID, []NewFormField{f})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("want ErrInvalidInput for collision with existing field, got %v", err)
	}
}

func TestAddFormFieldsEmptyAndOversized(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService()
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	if _, err := svc.AddFormFields(ctx, doc.ID, nil); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("empty: want ErrInvalidInput, got %v", err)
	}

	many := make([]NewFormField, maxNewFields+1)
	for i := range many {
		f := validField()
		many[i] = f
	}
	if _, err := svc.AddFormFields(ctx, doc.ID, many); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("oversized batch: want ErrInvalidInput, got %v", err)
	}
}

func TestAddFormFieldsUnknownDocument(t *testing.T) {
	svc, _ := newTestService()
	_, err := svc.AddFormFields(context.Background(), "ghost", []NewFormField{validField()})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}
