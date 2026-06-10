package document

import (
	"context"
	"errors"
	"testing"
)

// DeleteVersion mirrors FSStore's guards: v1, the head, and the only
// remaining version are undeletable; gaps in numbering are allowed.
func (f *fakeStore) DeleteVersion(_ context.Context, id string, n int) (*Document, error) {
	cur, ok := f.docs[id]
	if !ok {
		return nil, ErrNotFound
	}
	idx := -1
	for i, v := range cur.Versions {
		if v.N == n {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, ErrNotFound
	}
	if n == 1 || n == cur.HeadVersion || len(cur.Versions) == 1 {
		return nil, ErrInvalidInput
	}
	next := copyFakeDoc(cur)
	next.Versions = append(append([]Version{}, next.Versions[:idx]...), next.Versions[idx+1:]...)
	f.docs[id] = next
	delete(f.bytes, f.key(id, n))
	return copyFakeDoc(next), nil
}

func TestServiceDeleteVersion(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)
	// Grow history to v3 by restoring v1 twice.
	if _, err := svc.RestoreVersion(ctx, doc.ID, 1); err != nil {
		t.Fatalf("RestoreVersion: %v", err)
	}
	if _, err := svc.RestoreVersion(ctx, doc.ID, 1); err != nil {
		t.Fatalf("RestoreVersion: %v", err)
	}

	tests := []struct {
		name    string
		id      string
		n       int
		wantErr error
	}{
		{"v1 is undeletable", doc.ID, 1, ErrInvalidInput},
		{"head is undeletable", doc.ID, 3, ErrInvalidInput},
		{"missing version", doc.ID, 7, ErrNotFound},
		{"missing doc", "nope", 2, ErrNotFound},
		{"valid delete", doc.ID, 2, nil},
		{"already deleted", doc.ID, 2, ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := svc.DeleteVersion(ctx, tt.id, tt.n)
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
					t.Errorf("v%d still listed after delete", tt.n)
				}
			}
			if got.HeadVersion != 3 {
				t.Errorf("head changed: want 3, got %d", got.HeadVersion)
			}
		})
	}
}

func TestServiceVersionOpsAreGapSafe(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)
	_, _ = svc.RestoreVersion(ctx, doc.ID, 1) // v2
	_, _ = svc.RestoreVersion(ctx, doc.ID, 1) // v3
	if _, err := svc.DeleteVersion(ctx, doc.ID, 2); err != nil {
		t.Fatalf("DeleteVersion: %v", err)
	}

	// Download of the deleted version 404s; surviving versions still work.
	if _, err := svc.DownloadVersion(ctx, doc.ID, 2); !errors.Is(err, ErrNotFound) {
		t.Errorf("want ErrNotFound for deleted v2, got %v", err)
	}
	if _, err := svc.DownloadVersion(ctx, doc.ID, 3); err != nil {
		t.Errorf("v3 unreadable after deleting v2: %v", err)
	}

	// Restore across the gap creates v4 from v3's bytes.
	got, err := svc.RestoreVersion(ctx, doc.ID, 3)
	if err != nil {
		t.Fatalf("RestoreVersion across gap: %v", err)
	}
	if got.HeadVersion != 4 {
		t.Errorf("want head v4 after restore, got v%d", got.HeadVersion)
	}
}
