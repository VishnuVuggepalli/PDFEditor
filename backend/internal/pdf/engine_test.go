package pdf

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

func fixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "sample.pdf"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return b
}

func TestValidate(t *testing.T) {
	e := NewEngine()
	valid := fixture(t)

	tests := []struct {
		name    string
		input   []byte
		wantErr bool
	}{
		{"valid pdf", valid, false},
		{"empty input", nil, true},
		{"not a pdf", []byte("hello world this is text"), true},
		{"header only, garbage body", []byte("%PDF-1.7 then garbage"), true},
		{"truncated pdf", valid[:100], true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := e.Validate(tt.input)
			if tt.wantErr {
				if !errors.Is(err, document.ErrInvalidPDF) {
					t.Errorf("want ErrInvalidPDF, got %v", err)
				}
				return
			}
			if err != nil {
				t.Errorf("valid PDF rejected: %v", err)
			}
		})
	}
}

func TestInfo(t *testing.T) {
	e := NewEngine()
	info, err := e.Info(fixture(t))
	if err != nil {
		t.Fatalf("Info: %v", err)
	}
	if info.PageCount != 2 {
		t.Errorf("want 2 pages, got %d", info.PageCount)
	}
	if info.Encrypted {
		t.Error("fixture is not encrypted")
	}
	if info.HasForm {
		t.Error("fixture has no AcroForm")
	}
}

func TestInfoRejectsGarbage(t *testing.T) {
	e := NewEngine()
	_, err := e.Info([]byte("garbage"))
	if !errors.Is(err, document.ErrInvalidPDF) {
		t.Errorf("want ErrInvalidPDF, got %v", err)
	}
}
