package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// growVersions appends count extra versions and returns the resulting record.
func growVersions(t *testing.T, s *FSStore, id string, count int) *document.Document {
	t.Helper()
	ctx := context.Background()
	var doc *document.Document
	var err error
	for i := 0; i < count; i++ {
		doc, err = s.AddVersion(ctx, id, samplePDF, "edit")
		if err != nil {
			t.Fatalf("AddVersion: %v", err)
		}
	}
	return doc
}

// touch creates an empty file (and parents) for thumbnail-cache fixtures.
func touch(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte("png"), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestDeleteVersion(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)
	growVersions(t, s, doc.ID, 2) // v1 (upload) + v2 + v3 (head)

	tests := []struct {
		name    string
		id      string
		n       int
		wantErr error
	}{
		{"v1 is undeletable", doc.ID, 1, document.ErrInvalidInput},
		{"head is undeletable", doc.ID, 3, document.ErrInvalidInput},
		{"missing version", doc.ID, 9, document.ErrNotFound},
		{"missing doc", "nope", 2, document.ErrNotFound},
		{"valid delete", doc.ID, 2, nil},
		{"already deleted", doc.ID, 2, document.ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := s.DeleteVersion(ctx, tt.id, tt.n)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("want %v, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("DeleteVersion: %v", err)
			}
			for _, v := range got.Versions {
				if v.N == tt.n {
					t.Errorf("v%d still in returned record", tt.n)
				}
			}
			if got.HeadVersion != 3 {
				t.Errorf("head changed: want 3, got %d", got.HeadVersion)
			}
		})
	}
}

func TestDeleteVersionSoleVersionUndeletable(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF) // only v1 exists
	if _, err := s.DeleteVersion(ctx, doc.ID, 1); !errors.Is(err, document.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput deleting the only version, got %v", err)
	}
}

func TestDeleteVersionRemovesFilesAndThumbs(t *testing.T) {
	s, dir := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)
	growVersions(t, s, doc.ID, 2)

	thumbs := filepath.Join(dir, "documents", doc.ID, "thumbs")
	doomed1 := filepath.Join(thumbs, "v2-p1-w240.png")
	doomed2 := filepath.Join(thumbs, "v2-p2-w1024.png")
	kept := filepath.Join(thumbs, "v3-p1-w240.png")
	for _, p := range []string{doomed1, doomed2, kept} {
		touch(t, p)
	}

	if _, err := s.DeleteVersion(ctx, doc.ID, 2); err != nil {
		t.Fatalf("DeleteVersion: %v", err)
	}

	pdfPath := filepath.Join(dir, "documents", doc.ID, "v2.pdf")
	if _, err := os.Stat(pdfPath); !os.IsNotExist(err) {
		t.Errorf("v2.pdf still on disk: %v", err)
	}
	for _, p := range []string{doomed1, doomed2} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("deleted version thumb still on disk: %s", p)
		}
	}
	if _, err := os.Stat(kept); err != nil {
		t.Errorf("other version's thumb was removed: %v", err)
	}

	// Other versions remain readable.
	if _, err := s.VersionBytes(ctx, doc.ID, 3); err != nil {
		t.Errorf("v3 unreadable after deleting v2: %v", err)
	}
}

func TestDeleteVersionPersists(t *testing.T) {
	s, dir := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)
	growVersions(t, s, doc.ID, 2)
	if _, err := s.DeleteVersion(ctx, doc.ID, 2); err != nil {
		t.Fatalf("DeleteVersion: %v", err)
	}

	s2, err := NewFSStore(dir)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	got, err := s2.Get(ctx, doc.ID)
	if err != nil {
		t.Fatalf("Get after reopen: %v", err)
	}
	if len(got.Versions) != 2 || got.Versions[0].N != 1 || got.Versions[1].N != 3 {
		t.Errorf("want versions [1 3] after reopen, got %+v", got.Versions)
	}
	if _, err := s2.VersionBytes(ctx, doc.ID, 2); !errors.Is(err, document.ErrNotFound) {
		t.Errorf("want ErrNotFound for deleted v2 after reopen, got %v", err)
	}
}

func TestAddVersionAfterDeleteKeepsGapNumbering(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)
	growVersions(t, s, doc.ID, 2)
	if _, err := s.DeleteVersion(ctx, doc.ID, 2); err != nil {
		t.Fatalf("DeleteVersion: %v", err)
	}

	got, err := s.AddVersion(ctx, doc.ID, samplePDF, "edit")
	if err != nil {
		t.Fatalf("AddVersion after delete: %v", err)
	}
	if got.HeadVersion != 4 {
		t.Errorf("want new head v4 (gap preserved), got v%d", got.HeadVersion)
	}
	var ns []int
	for _, v := range got.Versions {
		ns = append(ns, v.N)
	}
	if len(ns) != 3 || ns[0] != 1 || ns[1] != 3 || ns[2] != 4 {
		t.Errorf("want versions [1 3 4], got %v", ns)
	}
}
