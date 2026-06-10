package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

func TestRename(t *testing.T) {
	s, dir := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "old.pdf", samplePDF)

	tests := []struct {
		name    string
		id      string
		newName string
		wantErr error
	}{
		{"valid rename", doc.ID, "new.pdf", nil},
		{"missing doc", "nope", "x.pdf", document.ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := s.Rename(ctx, tt.id, tt.newName)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("want %v, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Rename: %v", err)
			}
			if got.Name != tt.newName {
				t.Errorf("want name %q, got %q", tt.newName, got.Name)
			}
		})
	}

	// Rename must persist: a fresh store over the same dir sees the new name.
	s2, err := NewFSStore(dir)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	got, err := s2.Get(ctx, doc.ID)
	if err != nil {
		t.Fatalf("Get after reopen: %v", err)
	}
	if got.Name != "new.pdf" {
		t.Errorf("rename not persisted: got %q", got.Name)
	}
}

func TestRenameDoesNotMutateIndexedCopy(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)

	before, _ := s.Get(ctx, doc.ID)
	if _, err := s.Rename(ctx, doc.ID, "b.pdf"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if before.Name != "a.pdf" {
		t.Errorf("previously returned copy was mutated: %q", before.Name)
	}
}

func TestDelete(t *testing.T) {
	s, dir := newTestStore(t)
	ctx := context.Background()
	doc, _ := s.Create(ctx, "a.pdf", samplePDF)

	tests := []struct {
		name    string
		id      string
		wantErr error
	}{
		{"valid delete", doc.ID, nil},
		{"already deleted", doc.ID, document.ErrNotFound},
		{"missing doc", "nope", document.ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := s.Delete(ctx, tt.id)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("want %v, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Delete: %v", err)
			}
		})
	}

	// Gone from the index and from disk.
	if _, err := s.Get(ctx, doc.ID); !errors.Is(err, document.ErrNotFound) {
		t.Errorf("want ErrNotFound after delete, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "documents", doc.ID)); !os.IsNotExist(err) {
		t.Errorf("doc dir still on disk after delete: %v", err)
	}
}
