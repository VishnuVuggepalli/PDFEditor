package document

import (
	"context"
	"fmt"
	"regexp"
)

// Annotation types accepted by Annotate.
const (
	AnnHighlight = "highlight"
	AnnNote      = "note"
	AnnSquare    = "square"
	AnnInk       = "ink"
)

// Annotation is one markup annotation to embed into the PDF.
// Coordinates are in PDF points with a lower-left origin, matching what the
// frontend computes from the pdf.js viewport transform.
type Annotation struct {
	Type     string      `json:"type"`               // highlight | note | square | ink
	Page     int         `json:"page"`               // 1-based
	Rect     [4]float64  `json:"rect"`               // llx, lly, urx, ury
	Color    string      `json:"color"`              // "#RRGGBB"
	Contents string      `json:"contents,omitempty"` // comment / popup text
	Opacity  float64     `json:"opacity,omitempty"`  // 0..1, 0 means default (1)
	Paths    [][]float64 `json:"paths,omitempty"`    // ink only: strokes of flat x,y pairs
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// validateAnnotation checks one annotation against the document's page count.
func validateAnnotation(a Annotation, pageCount int) error {
	switch a.Type {
	case AnnHighlight, AnnNote, AnnSquare, AnnInk:
	default:
		return fmt.Errorf("%w: unknown annotation type %q", ErrInvalidInput, a.Type)
	}
	if a.Page < 1 || a.Page > pageCount {
		return fmt.Errorf("%w: page %d out of range 1..%d", ErrInvalidInput, a.Page, pageCount)
	}
	if a.Rect[0] >= a.Rect[2] || a.Rect[1] >= a.Rect[3] {
		return fmt.Errorf("%w: rect must be [llx,lly,urx,ury] with llx<urx and lly<ury", ErrInvalidInput)
	}
	if !hexColor.MatchString(a.Color) {
		return fmt.Errorf("%w: color must be #RRGGBB, got %q", ErrInvalidInput, a.Color)
	}
	if a.Opacity < 0 || a.Opacity > 1 {
		return fmt.Errorf("%w: opacity must be 0..1", ErrInvalidInput)
	}
	if a.Type == AnnInk {
		if len(a.Paths) == 0 {
			return fmt.Errorf("%w: ink annotation needs at least one path", ErrInvalidInput)
		}
		for i, p := range a.Paths {
			if len(p) < 4 || len(p)%2 != 0 {
				return fmt.Errorf("%w: ink path %d must be an even list of at least 4 coords", ErrInvalidInput, i+1)
			}
		}
	}
	return nil
}

// Annotate validates and embeds annotations into the head version, storing
// the result as a new version.
func (s *Service) Annotate(ctx context.Context, id string, annots []Annotation) (*Document, error) {
	if len(annots) == 0 {
		return nil, fmt.Errorf("%w: no annotations given", ErrInvalidInput)
	}

	cur, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := s.engine.Info(cur)
	if err != nil {
		return nil, fmt.Errorf("read pdf info: %w", err)
	}
	for i, a := range annots {
		if err := validateAnnotation(a, info.PageCount); err != nil {
			return nil, fmt.Errorf("annotation %d: %w", i+1, err)
		}
	}

	out, err := s.engine.Annotate(cur, annots)
	if err != nil {
		return nil, fmt.Errorf("apply annotations: %w", err)
	}

	doc, err := s.store.AddVersion(ctx, id, out, fmt.Sprintf("%d annotation(s)", len(annots)))
	if err != nil {
		return nil, fmt.Errorf("save new version: %w", err)
	}
	return doc, nil
}
