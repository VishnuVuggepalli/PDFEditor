package document

import (
	"context"
	"fmt"
)

// allowedPageSizes whitelists the blank-page sizes the API accepts. The empty
// string means "match the page next to the insertion point".
var allowedPageSizes = map[string]bool{
	"": true, "A3": true, "A4": true, "A5": true, "Letter": true, "Legal": true,
}

// maxInsertCount caps blank pages per request: enough for any manual edit,
// small enough that a typo can't balloon a document.
const maxInsertCount = 50

// InsertBlankPages inserts count blank pages so that the first one becomes
// page `at` (1-based; at == pageCount+1 appends at the end), and stores the
// result as a new version. An empty size matches the neighboring page.
func (s *Service) InsertBlankPages(ctx context.Context, id string, at, count int, size string) (*Document, error) {
	if count == 0 {
		count = 1
	}
	if count < 0 || count > maxInsertCount {
		return nil, fmt.Errorf("%w: count must be 1..%d", ErrInvalidInput, maxInsertCount)
	}
	if !allowedPageSizes[size] {
		return nil, fmt.Errorf("%w: unknown page size %q", ErrInvalidInput, size)
	}

	cur, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := s.engine.Info(cur)
	if err != nil {
		return nil, fmt.Errorf("read pdf info: %w", err)
	}
	if at < 1 || at > info.PageCount+1 {
		return nil, fmt.Errorf("%w: position %d out of range 1..%d", ErrInvalidInput, at, info.PageCount+1)
	}

	// pdfcpu inserts relative to an existing page: before page `at`, or after
	// the last page when appending at the end.
	page, before := at, true
	if at == info.PageCount+1 {
		page, before = info.PageCount, false
	}

	out, err := s.engine.InsertBlankPages(cur, page, before, count, size)
	if err != nil {
		return nil, fmt.Errorf("insert blank pages: %w", err)
	}

	doc, err := s.store.AddVersion(ctx, id, out, fmt.Sprintf("insert %d blank page(s) at p%d", count, at))
	if err != nil {
		return nil, fmt.Errorf("save new version: %w", err)
	}
	return doc, nil
}

// AppendFromDocument appends pages of another stored document (its head
// version) to the end of this one and stores the result as a new version.
// An empty pages list appends the whole source document. Pages are a
// selection, not an order: they are appended in source-document order.
func (s *Service) AppendFromDocument(ctx context.Context, id, sourceID string, pages []int) (*Document, error) {
	if sourceID == "" {
		return nil, fmt.Errorf("%w: sourceId must not be empty", ErrInvalidInput)
	}

	dst, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	src, srcDoc, err := s.Download(ctx, sourceID)
	if err != nil {
		return nil, fmt.Errorf("source %s: %w", sourceID, err)
	}
	srcInfo, err := s.engine.Info(src)
	if err != nil {
		return nil, fmt.Errorf("read source pdf info: %w", err)
	}

	part := src
	appended := srcInfo.PageCount
	if len(pages) > 0 {
		if err := checkPages(pages, srcInfo.PageCount); err != nil {
			return nil, err
		}
		unique := uniquePages(pages)
		part, err = s.engine.ExtractPages(src, unique)
		if err != nil {
			return nil, fmt.Errorf("extract source pages: %w", err)
		}
		appended = len(unique)
	}

	merged, err := s.engine.Merge([][]byte{dst, part})
	if err != nil {
		return nil, fmt.Errorf("append pages: %w", err)
	}

	summary := fmt.Sprintf("append %d page(s) from %q", appended, srcDoc.Name)
	doc, err := s.store.AddVersion(ctx, id, merged, summary)
	if err != nil {
		return nil, fmt.Errorf("save new version: %w", err)
	}
	return doc, nil
}
