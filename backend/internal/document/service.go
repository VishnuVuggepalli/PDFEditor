package document

import (
	"context"
	"fmt"
)

// Store is what the service needs from a persistence layer. Defined here, in
// the consumer package; implementations live elsewhere (e.g. internal/store).
type Store interface {
	// Create stores a new document with pdf as version 1.
	Create(ctx context.Context, name string, pdf []byte) (*Document, error)
	// Get returns the document record by ID.
	Get(ctx context.Context, id string) (*Document, error)
	// List returns all document records.
	List(ctx context.Context) ([]*Document, error)
	// VersionBytes returns the raw PDF bytes of version n.
	VersionBytes(ctx context.Context, id string, n int) ([]byte, error)
	// AddVersion appends pdf as a new head version with an operation summary.
	AddVersion(ctx context.Context, id string, pdf []byte, ops string) (*Document, error)
}

// Engine is what the service needs from a PDF engine. Implemented by
// internal/pdf (pdfcpu); kept narrow so the engine can be swapped.
type Engine interface {
	// Validate returns ErrInvalidPDF-wrapped detail if bytes are not a sound PDF.
	Validate(pdf []byte) error
	// Info computes PDF-intrinsic metadata from the bytes.
	Info(pdf []byte) (PDFInfo, error)
	// Rotate rotates the given 1-based pages clockwise by degrees (90/180/270).
	Rotate(pdf []byte, pages []int, degrees int) ([]byte, error)
	// DeletePages removes the given 1-based pages.
	DeletePages(pdf []byte, pages []int) ([]byte, error)
	// Reorder rearranges pages into the given order (a permutation of 1..n).
	Reorder(pdf []byte, order []int) ([]byte, error)
	// Merge concatenates the given PDFs, in order, into one.
	Merge(pdfs [][]byte) ([]byte, error)
	// ExtractPages produces a new PDF containing only the given pages.
	ExtractPages(pdf []byte, pages []int) ([]byte, error)
}

// Service orchestrates the store and the PDF engine. All document mutations
// in the application flow through here.
type Service struct {
	store  Store
	engine Engine
}

// NewService wires a Service from its dependencies.
func NewService(store Store, engine Engine) *Service {
	return &Service{store: store, engine: engine}
}

// Upload validates and stores a new PDF as a new document.
func (s *Service) Upload(ctx context.Context, name string, pdf []byte) (*Document, error) {
	if name == "" {
		return nil, fmt.Errorf("%w: empty name", ErrInvalidInput)
	}
	if err := s.engine.Validate(pdf); err != nil {
		return nil, err
	}
	doc, err := s.store.Create(ctx, name, pdf)
	if err != nil {
		return nil, fmt.Errorf("create document: %w", err)
	}
	return doc, nil
}

// Get returns a document record.
func (s *Service) Get(ctx context.Context, id string) (*Document, error) {
	return s.store.Get(ctx, id)
}

// List returns all document records.
func (s *Service) List(ctx context.Context) ([]*Document, error) {
	return s.store.List(ctx)
}

// Download returns the PDF bytes of the head version.
func (s *Service) Download(ctx context.Context, id string) ([]byte, *Document, error) {
	doc, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	b, err := s.store.VersionBytes(ctx, id, doc.HeadVersion)
	if err != nil {
		return nil, nil, err
	}
	return b, doc, nil
}

// DownloadVersion returns the PDF bytes of a specific version.
func (s *Service) DownloadVersion(ctx context.Context, id string, n int) ([]byte, error) {
	return s.store.VersionBytes(ctx, id, n)
}

// Meta returns the document record plus PDF-intrinsic metadata computed from
// the head version bytes.
func (s *Service) Meta(ctx context.Context, id string) (*Meta, error) {
	b, doc, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := s.engine.Info(b)
	if err != nil {
		return nil, fmt.Errorf("read pdf info: %w", err)
	}
	return &Meta{Document: *doc, PDF: info}, nil
}

// RestoreVersion copies version n's bytes as a new head version.
func (s *Service) RestoreVersion(ctx context.Context, id string, n int) (*Document, error) {
	b, err := s.store.VersionBytes(ctx, id, n)
	if err != nil {
		return nil, err
	}
	doc, err := s.store.AddVersion(ctx, id, b, fmt.Sprintf("restore v%d", n))
	if err != nil {
		return nil, fmt.Errorf("restore version: %w", err)
	}
	return doc, nil
}
