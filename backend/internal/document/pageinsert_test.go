package document

import (
	"context"
	"errors"
	"testing"
)

func TestInsertBlankPagesValidation(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		at      int
		count   int
		size    string
		wantErr bool
		wantOps string
	}{
		{"insert at start", 1, 1, "", false, "insert 1 blank page(s) at p1"},
		{"insert mid", 2, 1, "", false, "insert 1 blank page(s) at p2"},
		{"append at end (pageCount+1)", 4, 1, "", false, "insert 1 blank page(s) at p4"},
		{"count defaults to 1", 2, 0, "", false, "insert 1 blank page(s) at p2"},
		{"multiple pages", 1, 3, "", false, "insert 3 blank page(s) at p1"},
		{"explicit size", 1, 1, "Letter", false, "insert 1 blank page(s) at p1"},
		{"at zero", 0, 1, "", true, ""},
		{"at beyond end+1", 5, 1, "", true, ""},
		{"negative count", 1, -1, "", true, ""},
		{"count over cap", 1, maxInsertCount + 1, "", true, ""},
		{"bad size", 1, 1, "Banana", true, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _ := newTestService() // fakeEngine: 3 pages
			doc, err := svc.Upload(ctx, "a.pdf", validPDF)
			if err != nil {
				t.Fatalf("upload: %v", err)
			}
			out, err := svc.InsertBlankPages(ctx, doc.ID, tt.at, tt.count, tt.size)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("want ErrInvalidInput, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("InsertBlankPages: %v", err)
			}
			if out.HeadVersion != 2 {
				t.Errorf("want head v2, got v%d", out.HeadVersion)
			}
			if got := out.Versions[1].Ops; got != tt.wantOps {
				t.Errorf("ops: want %q, got %q", tt.wantOps, got)
			}
		})
	}
}

func TestInsertBlankPagesEngineCall(t *testing.T) {
	ctx := context.Background()
	st := newFakeStore()
	eng := &fakeEngine{info: PDFInfo{PageCount: 3}}
	svc := NewService(st, eng)
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	// Appending at pageCount+1 must translate to "after the last page".
	if _, err := svc.InsertBlankPages(ctx, doc.ID, 4, 2, ""); err != nil {
		t.Fatalf("InsertBlankPages: %v", err)
	}
	if len(eng.applied) != 1 || eng.applied[0] != "insert2_p3_beforefalse" {
		t.Errorf("engine call: got %v", eng.applied)
	}

	// Inserting mid-document targets the page itself, before it.
	eng.applied = nil
	if _, err := svc.InsertBlankPages(ctx, doc.ID, 2, 1, ""); err != nil {
		t.Fatalf("InsertBlankPages: %v", err)
	}
	if len(eng.applied) != 1 || eng.applied[0] != "insert1_p2_beforetrue" {
		t.Errorf("engine call: got %v", eng.applied)
	}
}

func TestAppendFromDocument(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService() // fakeEngine: every doc reports 3 pages
	dst, _ := svc.Upload(ctx, "target.pdf", validPDF)
	src, _ := svc.Upload(ctx, "source.pdf", validPDF)

	t.Run("append all pages", func(t *testing.T) {
		out, err := svc.AppendFromDocument(ctx, dst.ID, src.ID, nil)
		if err != nil {
			t.Fatalf("AppendFromDocument: %v", err)
		}
		want := `append 3 page(s) from "source.pdf"`
		if got := out.Versions[len(out.Versions)-1].Ops; got != want {
			t.Errorf("ops: want %q, got %q", want, got)
		}
	})

	t.Run("append selected pages", func(t *testing.T) {
		out, err := svc.AppendFromDocument(ctx, dst.ID, src.ID, []int{1, 3})
		if err != nil {
			t.Fatalf("AppendFromDocument: %v", err)
		}
		want := `append 2 page(s) from "source.pdf"`
		if got := out.Versions[len(out.Versions)-1].Ops; got != want {
			t.Errorf("ops: want %q, got %q", want, got)
		}
	})

	t.Run("page out of source range", func(t *testing.T) {
		_, err := svc.AppendFromDocument(ctx, dst.ID, src.ID, []int{4})
		if !errors.Is(err, ErrInvalidInput) {
			t.Errorf("want ErrInvalidInput, got %v", err)
		}
	})

	t.Run("empty sourceId", func(t *testing.T) {
		_, err := svc.AppendFromDocument(ctx, dst.ID, "", nil)
		if !errors.Is(err, ErrInvalidInput) {
			t.Errorf("want ErrInvalidInput, got %v", err)
		}
	})

	t.Run("unknown source", func(t *testing.T) {
		_, err := svc.AppendFromDocument(ctx, dst.ID, "ghost", nil)
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("want ErrNotFound, got %v", err)
		}
	})

	t.Run("unknown target", func(t *testing.T) {
		_, err := svc.AppendFromDocument(ctx, "ghost", src.ID, nil)
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("want ErrNotFound, got %v", err)
		}
	})
}
