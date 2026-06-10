package document

import (
	"context"
	"errors"
	"testing"
)

func TestServiceRename(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	tests := []struct {
		name    string
		id      string
		newName string
		wantErr error
	}{
		{"valid rename", doc.ID, "renamed.pdf", nil},
		{"empty name", doc.ID, "", ErrInvalidInput},
		{"missing doc", "nope", "x.pdf", ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := svc.Rename(ctx, tt.id, tt.newName)
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
				t.Errorf("want %q, got %q", tt.newName, got.Name)
			}
		})
	}
}

func TestServiceDelete(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	tests := []struct {
		name    string
		id      string
		wantErr error
	}{
		{"valid delete", doc.ID, nil},
		{"already gone", doc.ID, ErrNotFound},
		{"missing doc", "nope", ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := svc.Delete(ctx, tt.id)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("want %v, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Delete: %v", err)
			}
			if _, err := svc.Get(ctx, doc.ID); !errors.Is(err, ErrNotFound) {
				t.Errorf("doc still retrievable after delete: %v", err)
			}
		})
	}
}
