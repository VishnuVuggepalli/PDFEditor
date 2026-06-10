package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// newPruningStore builds an FSStore with a keep-last-N policy over a temp dir.
func newPruningStore(t *testing.T, max int) (*FSStore, string) {
	t.Helper()
	dir := t.TempDir()
	s, err := NewFSStore(dir, WithMaxVersions(max))
	if err != nil {
		t.Fatalf("NewFSStore: %v", err)
	}
	return s, dir
}

// addVersions creates a document and appends edits until it has total
// versions written (v1 = upload, v2..vTotal = edits), returning the doc ID
// and the record after the last append.
func addVersions(t *testing.T, s *FSStore, total int) (string, *document.Document) {
	t.Helper()
	ctx := context.Background()
	doc, err := s.Create(ctx, "a.pdf", samplePDF)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	for i := 2; i <= total; i++ {
		doc, err = s.AddVersion(ctx, doc.ID, []byte(fmt.Sprintf("%%PDF v%d", i)), fmt.Sprintf("edit %d", i))
		if err != nil {
			t.Fatalf("AddVersion %d: %v", i, err)
		}
	}
	return doc.ID, doc
}

// versionNumbers extracts the N of every entry, in slice order.
func versionNumbers(d *document.Document) []int {
	out := make([]int, 0, len(d.Versions))
	for _, v := range d.Versions {
		out = append(out, v.N)
	}
	return out
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestAddVersionPruning(t *testing.T) {
	tests := []struct {
		name  string
		max   int
		total int    // versions written (v1 + edits)
		want  []int  // surviving version numbers, oldest first
	}{
		{"unlimited keeps all", 0, 5, []int{1, 2, 3, 4, 5}},
		{"at boundary keeps all", 3, 3, []int{1, 2, 3}},
		{"one past boundary prunes oldest non-v1", 3, 4, []int{1, 3, 4}},
		{"steady state keeps v1 plus newest", 3, 6, []int{1, 5, 6}},
		{"max=2 collapses to v1 plus head", 2, 5, []int{1, 5}},
		{"max=1 still keeps v1 and head", 1, 4, []int{1, 4}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, dir := newPruningStore(t, tt.max)
			ctx := context.Background()
			id, doc := addVersions(t, s, tt.total)

			if got := versionNumbers(doc); !equalInts(got, tt.want) {
				t.Fatalf("surviving versions: want %v, got %v", tt.want, got)
			}
			if doc.HeadVersion != tt.total {
				t.Errorf("head: want %d, got %d", tt.total, doc.HeadVersion)
			}
			if doc.Head().N != tt.total {
				t.Errorf("Head() entry: want N=%d, got N=%d", tt.total, doc.Head().N)
			}

			// Disk state matches metadata: survivors exist, pruned files gone.
			keep := map[int]bool{}
			for _, n := range tt.want {
				keep[n] = true
			}
			for n := 1; n <= tt.total; n++ {
				_, err := os.Stat(filepath.Join(dir, "documents", id, fmt.Sprintf("v%d.pdf", n)))
				if keep[n] && err != nil {
					t.Errorf("v%d.pdf should exist: %v", n, err)
				}
				if !keep[n] && !os.IsNotExist(err) {
					t.Errorf("v%d.pdf should be deleted, stat err=%v", n, err)
				}

				// VersionBytes must be existence-based, not range-based.
				_, err = s.VersionBytes(ctx, id, n)
				if keep[n] && err != nil {
					t.Errorf("VersionBytes(%d) on survivor: %v", n, err)
				}
				if !keep[n] && !errors.Is(err, document.ErrNotFound) {
					t.Errorf("VersionBytes(%d) on pruned version: want ErrNotFound, got %v", n, err)
				}
			}
		})
	}
}

func TestPruningKeepsNumberingStable(t *testing.T) {
	s, _ := newPruningStore(t, 3)
	ctx := context.Background()
	id, _ := addVersions(t, s, 5) // survivors: v1, v4, v5

	// The next append must continue from the head, never reuse pruned numbers.
	doc, err := s.AddVersion(ctx, id, []byte("%PDF v6"), "edit 6")
	if err != nil {
		t.Fatalf("AddVersion: %v", err)
	}
	if doc.HeadVersion != 6 {
		t.Errorf("want head=6 after prior prunes, got %d", doc.HeadVersion)
	}
	if got := versionNumbers(doc); !equalInts(got, []int{1, 5, 6}) {
		t.Errorf("want versions [1 5 6], got %v", got)
	}
}

func TestPrunedMetaConsistentAcrossReopen(t *testing.T) {
	s, dir := newPruningStore(t, 3)
	ctx := context.Background()
	id, _ := addVersions(t, s, 6) // survivors: v1, v5, v6

	// Simulate container restart: rebuild the index from meta.json files.
	s2, err := NewFSStore(dir, WithMaxVersions(3))
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	doc, err := s2.Get(ctx, id)
	if err != nil {
		t.Fatalf("Get after reopen: %v", err)
	}
	if got := versionNumbers(doc); !equalInts(got, []int{1, 5, 6}) {
		t.Errorf("rebuilt index versions: want [1 5 6], got %v", got)
	}
	if doc.HeadVersion != 6 {
		t.Errorf("rebuilt head: want 6, got %d", doc.HeadVersion)
	}

	// Gap-safety survives the rebuild.
	if _, err := s2.VersionBytes(ctx, id, 3); !errors.Is(err, document.ErrNotFound) {
		t.Errorf("pruned v3 after reopen: want ErrNotFound, got %v", err)
	}
	if b, err := s2.VersionBytes(ctx, id, 5); err != nil || string(b) != "%PDF v5" {
		t.Errorf("survivor v5 after reopen: bytes %q, err %v", b, err)
	}
}

func TestPruningRemovesThumbnails(t *testing.T) {
	s, dir := newPruningStore(t, 3)
	ctx := context.Background()
	id, _ := addVersions(t, s, 3) // at boundary: nothing pruned yet

	// Plant cached thumbnails for v1 and v2 (and a v12 decoy that the v2
	// cleanup glob must not match).
	thumbs := filepath.Join(dir, "documents", id, "thumbs")
	if err := os.MkdirAll(thumbs, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"v1-p1-w240.png", "v2-p1-w240.png", "v2-p2-w480.png", "v12-p1-w240.png"} {
		if err := os.WriteFile(filepath.Join(thumbs, f), []byte("png"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// v4 triggers pruning of v2.
	if _, err := s.AddVersion(ctx, id, []byte("%PDF v4"), "edit 4"); err != nil {
		t.Fatalf("AddVersion: %v", err)
	}

	for f, wantGone := range map[string]bool{
		"v1-p1-w240.png":  false, // v1 never pruned
		"v2-p1-w240.png":  true,
		"v2-p2-w480.png":  true,
		"v12-p1-w240.png": false, // glob for v2 must not match v12
	} {
		_, err := os.Stat(filepath.Join(thumbs, f))
		if wantGone && !os.IsNotExist(err) {
			t.Errorf("%s should be deleted, stat err=%v", f, err)
		}
		if !wantGone && err != nil {
			t.Errorf("%s should survive: %v", f, err)
		}
	}
}

func TestPruningUnsetByDefault(t *testing.T) {
	// A store constructed without WithMaxVersions must never prune.
	s, _ := newTestStore(t)
	_, doc := addVersions(t, s, 30)
	if len(doc.Versions) != 30 {
		t.Errorf("default store pruned: want 30 versions, got %d", len(doc.Versions))
	}
}
