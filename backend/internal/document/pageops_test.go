package document

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func newPageOpsService(pageCount int) (*Service, *fakeStore, *fakeEngine) {
	st := newFakeStore()
	eng := &fakeEngine{info: PDFInfo{PageCount: pageCount}}
	return NewService(st, eng), st, eng
}

func TestApplyPageOpsValidation(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name      string
		pageCount int
		ops       []PageOp
		wantErr   bool
	}{
		{"valid rotate", 5, []PageOp{{Type: OpRotate, Pages: []int{1, 3}, Degrees: 90}}, false},
		{"valid delete", 5, []PageOp{{Type: OpDelete, Pages: []int{5}}}, false},
		{"valid reorder", 3, []PageOp{{Type: OpReorder, Order: []int{3, 1, 2}}}, false},
		{"combined ops", 5, []PageOp{
			{Type: OpRotate, Pages: []int{1}, Degrees: 180},
			{Type: OpDelete, Pages: []int{5}},
		}, false},
		{"no ops", 5, nil, true},
		{"bad degrees", 5, []PageOp{{Type: OpRotate, Pages: []int{1}, Degrees: 45}}, true},
		{"rotate empty pages", 5, []PageOp{{Type: OpRotate, Degrees: 90}}, true},
		{"page out of range", 5, []PageOp{{Type: OpRotate, Pages: []int{6}, Degrees: 90}}, true},
		{"page zero", 5, []PageOp{{Type: OpDelete, Pages: []int{0}}}, true},
		{"delete all pages", 2, []PageOp{{Type: OpDelete, Pages: []int{1, 2}}}, true},
		{"reorder wrong length", 3, []PageOp{{Type: OpReorder, Order: []int{2, 1}}}, true},
		{"reorder duplicate", 3, []PageOp{{Type: OpReorder, Order: []int{1, 1, 2}}}, true},
		{"unknown op", 5, []PageOp{{Type: "explode"}}, true},
		// Sequential awareness: after deleting p5 of 5, page 5 no longer exists.
		{"stale page after delete", 5, []PageOp{
			{Type: OpDelete, Pages: []int{5}},
			{Type: OpRotate, Pages: []int{5}, Degrees: 90},
		}, true},
		// Reorder after delete validates against the shrunken count.
		{"reorder after delete", 3, []PageOp{
			{Type: OpDelete, Pages: []int{3}},
			{Type: OpReorder, Order: []int{2, 1}},
		}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _, _ := newPageOpsService(tt.pageCount)
			doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

			_, err := svc.ApplyPageOps(ctx, doc.ID, tt.ops)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidInput) {
					t.Errorf("want ErrInvalidInput, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ApplyPageOps: %v", err)
			}
		})
	}
}

func TestApplyPageOpsCreatesVersionWithSummary(t *testing.T) {
	ctx := context.Background()
	svc, _, eng := newPageOpsService(5)
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	updated, err := svc.ApplyPageOps(ctx, doc.ID, []PageOp{
		{Type: OpRotate, Pages: []int{1, 2}, Degrees: 90},
		{Type: OpDelete, Pages: []int{5}},
	})
	if err != nil {
		t.Fatalf("ApplyPageOps: %v", err)
	}
	if updated.HeadVersion != 2 {
		t.Errorf("want head=2, got %d", updated.HeadVersion)
	}
	sum := updated.Head().Ops
	if !strings.Contains(sum, "rotate p1,p2 90°") || !strings.Contains(sum, "delete p5") {
		t.Errorf("summary missing ops: %q", sum)
	}
	if len(eng.applied) != 2 || eng.applied[0] != "rotate90" || eng.applied[1] != "delete" {
		t.Errorf("engine ops applied wrong: %v", eng.applied)
	}
}

func TestApplyPageOpsNotFound(t *testing.T) {
	svc, _, _ := newPageOpsService(5)
	_, err := svc.ApplyPageOps(context.Background(), "missing",
		[]PageOp{{Type: OpRotate, Pages: []int{1}, Degrees: 90}})
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestMerge(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := newPageOpsService(2)
	a, _ := svc.Upload(ctx, "a.pdf", validPDF)
	b, _ := svc.Upload(ctx, "b.pdf", validPDF)

	merged, err := svc.Merge(ctx, []string{a.ID, b.ID}, "merged.pdf")
	if err != nil {
		t.Fatalf("Merge: %v", err)
	}
	if merged.Name != "merged.pdf" || merged.HeadVersion != 1 {
		t.Errorf("unexpected merged doc: %+v", merged)
	}

	tests := []struct {
		name    string
		ids     []string
		docName string
		wantErr error
	}{
		{"one id only", []string{a.ID}, "x.pdf", ErrInvalidInput},
		{"empty name", []string{a.ID, b.ID}, "", ErrInvalidInput},
		{"missing source", []string{a.ID, "nope"}, "x.pdf", ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := svc.Merge(ctx, tt.ids, tt.docName); !errors.Is(err, tt.wantErr) {
				t.Errorf("want %v, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestSplit(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := newPageOpsService(10)
	doc, _ := svc.Upload(ctx, "big.pdf", validPDF)

	parts, err := svc.Split(ctx, doc.ID, []SplitRange{{From: 1, To: 3}, {From: 4, To: 10}})
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	if len(parts) != 2 {
		t.Fatalf("want 2 parts, got %d", len(parts))
	}
	if parts[0].Name != "big (p1-3).pdf" || parts[1].Name != "big (p4-10).pdf" {
		t.Errorf("part names wrong: %q, %q", parts[0].Name, parts[1].Name)
	}

	// Source untouched.
	src, _ := svc.Get(ctx, doc.ID)
	if src.HeadVersion != 1 {
		t.Errorf("split must not touch source, head=%d", src.HeadVersion)
	}

	tests := []struct {
		name   string
		ranges []SplitRange
	}{
		{"no ranges", nil},
		{"from zero", []SplitRange{{From: 0, To: 3}}},
		{"beyond end", []SplitRange{{From: 1, To: 11}}},
		{"inverted", []SplitRange{{From: 5, To: 2}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := svc.Split(ctx, doc.ID, tt.ranges); !errors.Is(err, ErrInvalidInput) {
				t.Errorf("want ErrInvalidInput, got %v", err)
			}
		})
	}
}
