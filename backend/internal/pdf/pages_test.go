package pdf

import (
	"testing"
)

// pageCount is a test helper reading the count via the engine itself.
func pageCount(t *testing.T, e *Engine, pdf []byte) int {
	t.Helper()
	info, err := e.Info(pdf)
	if err != nil {
		t.Fatalf("Info: %v", err)
	}
	return info.PageCount
}

func TestRotateKeepsPageCount(t *testing.T) {
	e := NewEngine()
	src := fixture(t) // 2 pages

	out, err := e.Rotate(src, []int{1}, 90)
	if err != nil {
		t.Fatalf("Rotate: %v", err)
	}
	if err := e.Validate(out); err != nil {
		t.Fatalf("rotated output invalid: %v", err)
	}
	if n := pageCount(t, e, out); n != 2 {
		t.Errorf("want 2 pages after rotate, got %d", n)
	}
}

func TestDeletePages(t *testing.T) {
	e := NewEngine()
	src := fixture(t) // 2 pages

	out, err := e.DeletePages(src, []int{2})
	if err != nil {
		t.Fatalf("DeletePages: %v", err)
	}
	if n := pageCount(t, e, out); n != 1 {
		t.Errorf("want 1 page after delete, got %d", n)
	}
}

func TestReorder(t *testing.T) {
	e := NewEngine()
	src := fixture(t) // 2 pages

	out, err := e.Reorder(src, []int{2, 1})
	if err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	if err := e.Validate(out); err != nil {
		t.Fatalf("reordered output invalid: %v", err)
	}
	if n := pageCount(t, e, out); n != 2 {
		t.Errorf("want 2 pages after reorder, got %d", n)
	}
}

func TestMerge(t *testing.T) {
	e := NewEngine()
	src := fixture(t) // 2 pages

	out, err := e.Merge([][]byte{src, src})
	if err != nil {
		t.Fatalf("Merge: %v", err)
	}
	if n := pageCount(t, e, out); n != 4 {
		t.Errorf("want 4 pages after merging two 2-page docs, got %d", n)
	}
}

func TestExtractPages(t *testing.T) {
	e := NewEngine()
	src := fixture(t) // 2 pages

	out, err := e.ExtractPages(src, []int{1})
	if err != nil {
		t.Fatalf("ExtractPages: %v", err)
	}
	if n := pageCount(t, e, out); n != 1 {
		t.Errorf("want 1 page after extract, got %d", n)
	}
}

func TestPageOpsOnGarbageFail(t *testing.T) {
	e := NewEngine()
	garbage := []byte("%PDF-1.7 not really")

	if _, err := e.Rotate(garbage, []int{1}, 90); err == nil {
		t.Error("Rotate on garbage should fail")
	}
	if _, err := e.Merge([][]byte{garbage, garbage}); err == nil {
		t.Error("Merge on garbage should fail")
	}
}
