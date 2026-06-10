package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

var samplePDF = []byte("%PDF-1.4 fake bytes for store tests")

func newTestStore(t *testing.T) (*FSStore, string) {
	t.Helper()
	dir := t.TempDir()
	s, err := NewFSStore(dir)
	if err != nil {
		t.Fatalf("NewFSStore: %v", err)
	}
	return s, dir
}

func TestCreateAndGet(t *testing.T) {
	s, dir := newTestStore(t)
	ctx := context.Background()

	doc, err := s.Create(ctx, "a.pdf", samplePDF)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if doc.HeadVersion != 1 || len(doc.Versions) != 1 {
		t.Errorf("want head=1 with 1 version, got head=%d versions=%d", doc.HeadVersion, len(doc.Versions))
	}
	if doc.Versions[0].Ops != "upload" {
		t.Errorf("want ops=upload, got %q", doc.Versions[0].Ops)
	}
	if doc.Versions[0].Size != int64(len(samplePDF)) {
		t.Errorf("want size=%d, got %d", len(samplePDF), doc.Versions[0].Size)
	}

	got, err := s.Get(ctx, doc.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Name != "a.pdf" {
		t.Errorf("want name a.pdf, got %q", got.Name)
	}

	// Files actually on disk.
	for _, f := range []string{"meta.json", "v1.pdf"} {
		if _, err := os.Stat(filepath.Join(dir, "documents", doc.ID, f)); err != nil {
			t.Errorf("expected %s on disk: %v", f, err)
		}
	}
}

func TestGetNotFound(t *testing.T) {
	s, _ := newTestStore(t)
	_, err := s.Get(context.Background(), "missing")
	if !errors.Is(err, document.ErrNotFound) {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestVersionBytes(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)

	tests := []struct {
		name    string
		n       int
		wantErr bool
	}{
		{"valid version", 1, false},
		{"zero version", 0, true},
		{"beyond head", 2, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, err := s.VersionBytes(ctx, doc.ID, tt.n)
			if tt.wantErr {
				if !errors.Is(err, document.ErrNotFound) {
					t.Errorf("want ErrNotFound, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("VersionBytes: %v", err)
			}
			if string(b) != string(samplePDF) {
				t.Errorf("bytes mismatch")
			}
		})
	}
}

func TestAddVersionImmutability(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)

	v2 := []byte("%PDF-1.4 second version")
	updated, err := s.AddVersion(ctx, doc.ID, v2, "rotate p1")
	if err != nil {
		t.Fatalf("AddVersion: %v", err)
	}
	if updated.HeadVersion != 2 || len(updated.Versions) != 2 {
		t.Fatalf("want head=2 versions=2, got head=%d versions=%d", updated.HeadVersion, len(updated.Versions))
	}

	// v1 untouched.
	b1, err := s.VersionBytes(ctx, doc.ID, 1)
	if err != nil {
		t.Fatalf("VersionBytes v1: %v", err)
	}
	if string(b1) != string(samplePDF) {
		t.Error("v1 bytes changed after AddVersion — versions must be immutable")
	}
	// v2 readable.
	b2, _ := s.VersionBytes(ctx, doc.ID, 2)
	if string(b2) != string(v2) {
		t.Error("v2 bytes mismatch")
	}
}

func TestReturnedDocIsACopy(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)

	doc.Name = "mutated"
	doc.Versions[0].Ops = "mutated"

	fresh, _ := s.Get(ctx, doc.ID)
	if fresh.Name != "a.pdf" || fresh.Versions[0].Ops != "upload" {
		t.Error("mutating a returned document leaked into the store index")
	}
}

func TestIndexRebuildAcrossRestart(t *testing.T) {
	s, dir := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)
	if _, err := s.AddVersion(ctx, doc.ID, []byte("%PDF v2"), "edit"); err != nil {
		t.Fatalf("AddVersion: %v", err)
	}

	// Simulate container restart: brand-new store over the same data dir.
	s2, err := NewFSStore(dir)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	got, err := s2.Get(ctx, doc.ID)
	if err != nil {
		t.Fatalf("Get after reopen: %v", err)
	}
	if got.HeadVersion != 2 || got.Name != "a.pdf" {
		t.Errorf("index rebuild lost state: head=%d name=%q", got.HeadVersion, got.Name)
	}

	docs, _ := s2.List(ctx)
	if len(docs) != 1 {
		t.Errorf("want 1 doc after rebuild, got %d", len(docs))
	}
}

func TestRebuildSkipsCorruptEntries(t *testing.T) {
	s, dir := newTestStore(t)
	ctx := context.Background()
	good, _ := s.Create(ctx, "good.pdf", samplePDF)

	// Plant a corrupt document dir.
	bad := filepath.Join(dir, "documents", "corrupt-entry")
	if err := os.MkdirAll(bad, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bad, "meta.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}

	s2, err := NewFSStore(dir)
	if err != nil {
		t.Fatalf("reopen with corrupt entry should not fail boot: %v", err)
	}
	docs, _ := s2.List(ctx)
	if len(docs) != 1 || docs[0].ID != good.ID {
		t.Errorf("want only the good doc indexed, got %d docs", len(docs))
	}
}
