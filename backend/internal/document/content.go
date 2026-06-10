package document

import (
	"context"
	"fmt"
)

// MaxContentPDFBytes caps client-edited PDF uploads at 50 MB.
const MaxContentPDFBytes = 50 << 20

// ReplaceContent stores a client-edited full PDF (e.g. produced by the
// in-browser mupdf engine's text edit) as a new head version. The bytes are
// validated with the PDF engine before anything is persisted.
func (s *Service) ReplaceContent(ctx context.Context, id string, pdf []byte) (*Document, error) {
	if len(pdf) == 0 {
		return nil, fmt.Errorf("%w: empty pdf", ErrInvalidInput)
	}
	if len(pdf) > MaxContentPDFBytes {
		return nil, fmt.Errorf("%w: pdf exceeds %d MB limit", ErrInvalidInput, MaxContentPDFBytes>>20)
	}
	if _, err := s.store.Get(ctx, id); err != nil {
		return nil, err
	}
	if err := s.engine.Validate(pdf); err != nil {
		return nil, err
	}
	doc, err := s.store.AddVersion(ctx, id, pdf, "content edit")
	if err != nil {
		return nil, fmt.Errorf("add content version: %w", err)
	}
	return doc, nil
}
