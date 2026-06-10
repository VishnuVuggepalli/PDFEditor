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
	// Rename updates the document's display name.
	Rename(ctx context.Context, id string, name string) (*Document, error)
	// Delete removes the document and all of its versions.
	Delete(ctx context.Context, id string) error
	// DeleteVersion removes one version (never v1, the head, or the only
	// remaining version) and returns the updated record.
	DeleteVersion(ctx context.Context, id string, n int) (*Document, error)
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
	// Annotate embeds the given (pre-validated) annotations into the PDF.
	Annotate(pdf []byte, annots []Annotation) ([]byte, error)
	// StampImage draws a PNG/JPEG image stamp onto one page, fitted into
	// rect ([llx,lly,urx,ury], PDF points) with aspect ratio preserved.
	StampImage(pdf []byte, page int, rect [4]float64, img []byte) ([]byte, error)
	// FormFields lists AcroForm fields.
	FormFields(pdf []byte) ([]FormField, error)
	// FillForm sets field values keyed by field ID or name.
	FillForm(pdf []byte, values map[string]string) ([]byte, error)
	// AddFormFields creates new AcroForm fields (pre-validated) on existing pages.
	AddFormFields(pdf []byte, fields []NewFormField) ([]byte, error)
	// InsertBlankPages inserts count blank pages before or after the given
	// 1-based page. An empty size matches that page's dimensions.
	InsertBlankPages(pdf []byte, page int, before bool, count int, size string) ([]byte, error)
}

// MaxNameBytes caps document display names (bytes, not runes): long enough
// for any sane filename, short enough to bound headers and meta.json growth.
const MaxNameBytes = 1024

// validateName rejects empty and oversized document names.
func validateName(name string) error {
	if name == "" {
		return fmt.Errorf("%w: empty name", ErrInvalidInput)
	}
	if len(name) > MaxNameBytes {
		return fmt.Errorf("%w: name exceeds %d bytes (got %d)", ErrInvalidInput, MaxNameBytes, len(name))
	}
	return nil
}

// Service orchestrates the store and the PDF engine. All document mutations
// in the application flow through here.
type Service struct {
	store  Store
	engine Engine

	// Optional digital-signing dependencies; see SetSigning in sign.go.
	signer       Signer
	sigValidator SignatureValidator
}

// NewService wires a Service from its dependencies.
func NewService(store Store, engine Engine) *Service {
	return &Service{store: store, engine: engine}
}

// Upload validates and stores a new PDF as a new document.
func (s *Service) Upload(ctx context.Context, name string, pdf []byte) (*Document, error) {
	if err := validateName(name); err != nil {
		return nil, err
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

// Rename updates a document's display name.
func (s *Service) Rename(ctx context.Context, id string, name string) (*Document, error) {
	if err := validateName(name); err != nil {
		return nil, err
	}
	doc, err := s.store.Rename(ctx, id, name)
	if err != nil {
		return nil, fmt.Errorf("rename document: %w", err)
	}
	return doc, nil
}

// Delete removes a document and its entire version history.
func (s *Service) Delete(ctx context.Context, id string) error {
	if err := s.store.Delete(ctx, id); err != nil {
		return fmt.Errorf("delete document: %w", err)
	}
	return nil
}

// DeleteVersion removes one version from a document's history. The store
// enforces the guards (v1, head, and the only remaining version are
// undeletable) atomically under its lock.
func (s *Service) DeleteVersion(ctx context.Context, id string, n int) (*Document, error) {
	doc, err := s.store.DeleteVersion(ctx, id, n)
	if err != nil {
		return nil, fmt.Errorf("delete version v%d: %w", n, err)
	}
	return doc, nil
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
