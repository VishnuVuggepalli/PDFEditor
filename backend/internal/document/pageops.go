package document

import (
	"context"
	"fmt"
	"strings"
)

// Page operation types accepted by ApplyPageOps.
const (
	OpRotate  = "rotate"
	OpDelete  = "delete"
	OpReorder = "reorder"
)

// PageOp is one page-level operation. Operations are applied in order, each
// against the result of the previous one.
type PageOp struct {
	Type    string `json:"type"`              // rotate | delete | reorder
	Pages   []int  `json:"pages,omitempty"`   // rotate, delete: 1-based page numbers
	Degrees int    `json:"degrees,omitempty"` // rotate: 90, 180 or 270
	Order   []int  `json:"order,omitempty"`   // reorder: permutation of 1..pageCount
}

// SplitRange selects an inclusive 1-based page range to extract.
type SplitRange struct {
	From int `json:"from"`
	To   int `json:"to"`
}

// validatePageOp checks op against the current page count and returns the
// page count after the op is applied.
func validatePageOp(op PageOp, pageCount int) (int, error) {
	switch op.Type {
	case OpRotate:
		if op.Degrees != 90 && op.Degrees != 180 && op.Degrees != 270 {
			return 0, fmt.Errorf("%w: rotate degrees must be 90, 180 or 270", ErrInvalidInput)
		}
		if err := checkPages(op.Pages, pageCount); err != nil {
			return 0, err
		}
		return pageCount, nil

	case OpDelete:
		if err := checkPages(op.Pages, pageCount); err != nil {
			return 0, err
		}
		if len(uniquePages(op.Pages)) >= pageCount {
			return 0, fmt.Errorf("%w: cannot delete every page", ErrInvalidInput)
		}
		return pageCount - len(uniquePages(op.Pages)), nil

	case OpReorder:
		if len(op.Order) != pageCount {
			return 0, fmt.Errorf("%w: reorder must list all %d pages", ErrInvalidInput, pageCount)
		}
		seen := make(map[int]bool, len(op.Order))
		for _, p := range op.Order {
			if p < 1 || p > pageCount || seen[p] {
				return 0, fmt.Errorf("%w: reorder must be a permutation of 1..%d", ErrInvalidInput, pageCount)
			}
			seen[p] = true
		}
		return pageCount, nil

	default:
		return 0, fmt.Errorf("%w: unknown op type %q", ErrInvalidInput, op.Type)
	}
}

func checkPages(pages []int, pageCount int) error {
	if len(pages) == 0 {
		return fmt.Errorf("%w: pages list is empty", ErrInvalidInput)
	}
	for _, p := range pages {
		if p < 1 || p > pageCount {
			return fmt.Errorf("%w: page %d out of range 1..%d", ErrInvalidInput, p, pageCount)
		}
	}
	return nil
}

func uniquePages(pages []int) []int {
	seen := make(map[int]bool, len(pages))
	out := make([]int, 0, len(pages))
	for _, p := range pages {
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

// summarize renders a human-readable operation summary for version history.
func summarize(ops []PageOp) string {
	parts := make([]string, 0, len(ops))
	for _, op := range ops {
		switch op.Type {
		case OpRotate:
			parts = append(parts, fmt.Sprintf("rotate %s %d°", pageList(op.Pages), op.Degrees))
		case OpDelete:
			parts = append(parts, fmt.Sprintf("delete %s", pageList(op.Pages)))
		case OpReorder:
			parts = append(parts, "reorder pages")
		}
	}
	return strings.Join(parts, "; ")
}

func pageList(pages []int) string {
	s := make([]string, len(pages))
	for i, p := range pages {
		s[i] = fmt.Sprintf("p%d", p)
	}
	return strings.Join(s, ",")
}

// ApplyPageOps applies ops sequentially to the head version and stores the
// result as a new version.
func (s *Service) ApplyPageOps(ctx context.Context, id string, ops []PageOp) (*Document, error) {
	if len(ops) == 0 {
		return nil, fmt.Errorf("%w: no operations given", ErrInvalidInput)
	}

	cur, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := s.engine.Info(cur)
	if err != nil {
		return nil, fmt.Errorf("read pdf info: %w", err)
	}

	pageCount := info.PageCount
	for i, op := range ops {
		next, err := validatePageOp(op, pageCount)
		if err != nil {
			return nil, fmt.Errorf("op %d: %w", i+1, err)
		}
		pageCount = next

		switch op.Type {
		case OpRotate:
			cur, err = s.engine.Rotate(cur, op.Pages, op.Degrees)
		case OpDelete:
			cur, err = s.engine.DeletePages(cur, uniquePages(op.Pages))
		case OpReorder:
			cur, err = s.engine.Reorder(cur, op.Order)
		}
		if err != nil {
			return nil, fmt.Errorf("apply op %d (%s): %w", i+1, op.Type, err)
		}
	}

	doc, err := s.store.AddVersion(ctx, id, cur, summarize(ops))
	if err != nil {
		return nil, fmt.Errorf("save new version: %w", err)
	}
	return doc, nil
}

// Merge combines the head versions of the given documents, in order, into a
// brand-new document.
func (s *Service) Merge(ctx context.Context, ids []string, name string) (*Document, error) {
	if len(ids) < 2 {
		return nil, fmt.Errorf("%w: merge needs at least 2 documents", ErrInvalidInput)
	}
	if name == "" {
		return nil, fmt.Errorf("%w: empty name", ErrInvalidInput)
	}

	pdfs := make([][]byte, 0, len(ids))
	for _, id := range ids {
		b, _, err := s.Download(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("source %s: %w", id, err)
		}
		pdfs = append(pdfs, b)
	}

	merged, err := s.engine.Merge(pdfs)
	if err != nil {
		return nil, fmt.Errorf("merge: %w", err)
	}
	doc, err := s.store.Create(ctx, name, merged)
	if err != nil {
		return nil, fmt.Errorf("store merged document: %w", err)
	}
	return doc, nil
}

// Split extracts each range from the head version into a new document and
// returns the created documents. The source document is left untouched.
func (s *Service) Split(ctx context.Context, id string, ranges []SplitRange) ([]*Document, error) {
	if len(ranges) == 0 {
		return nil, fmt.Errorf("%w: no ranges given", ErrInvalidInput)
	}

	src, srcDoc, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := s.engine.Info(src)
	if err != nil {
		return nil, fmt.Errorf("read pdf info: %w", err)
	}

	for i, r := range ranges {
		if r.From < 1 || r.To > info.PageCount || r.From > r.To {
			return nil, fmt.Errorf("%w: range %d (%d-%d) invalid for %d pages",
				ErrInvalidInput, i+1, r.From, r.To, info.PageCount)
		}
	}

	base := strings.TrimSuffix(srcDoc.Name, ".pdf")
	out := make([]*Document, 0, len(ranges))
	for _, r := range ranges {
		pages := make([]int, 0, r.To-r.From+1)
		for p := r.From; p <= r.To; p++ {
			pages = append(pages, p)
		}
		part, err := s.engine.ExtractPages(src, pages)
		if err != nil {
			return nil, fmt.Errorf("extract pages %d-%d: %w", r.From, r.To, err)
		}
		doc, err := s.store.Create(ctx, fmt.Sprintf("%s (p%d-%d).pdf", base, r.From, r.To), part)
		if err != nil {
			return nil, fmt.Errorf("store split part: %w", err)
		}
		out = append(out, doc)
	}
	return out, nil
}
