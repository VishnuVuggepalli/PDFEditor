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
	AnnText      = "text"
	AnnCircle    = "circle"
	AnnLine      = "line"
)

// Font size whitelist bounds for free-text annotations (PDF points).
const (
	MinFontSize = 8
	MaxFontSize = 72
)

// maxBorderWidth caps stroke widths so a typo can't black out a page.
const maxBorderWidth = 12

// Annotation is one markup annotation to embed into the PDF.
// Coordinates are in PDF points with a lower-left origin, matching what the
// frontend computes from the pdf.js viewport transform.
type Annotation struct {
	Type     string      `json:"type"`               // highlight | note | square | ink | text | circle | line
	Page     int         `json:"page"`               // 1-based
	Rect     [4]float64  `json:"rect"`               // llx, lly, urx, ury
	Color    string      `json:"color"`              // "#RRGGBB" (text: font color)
	Contents string      `json:"contents,omitempty"` // comment / popup text; text: the visible text
	Opacity  float64     `json:"opacity,omitempty"`  // 0..1, 0 means default (1)
	Paths    [][]float64 `json:"paths,omitempty"`    // ink only: strokes of flat x,y pairs

	FontSize    int       `json:"fontSize,omitempty"`    // text only: 8..72 points
	Bg          string    `json:"bg,omitempty"`          // text only: optional "#RRGGBB" background
	BorderWidth float64   `json:"borderWidth,omitempty"` // text/square/circle/line: stroke width, 0 = default
	Line        []float64 `json:"line,omitempty"`        // line only: [x1,y1,x2,y2] endpoints
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// validateAnnotation checks one annotation against the document's page count.
func validateAnnotation(a Annotation, pageCount int) error {
	switch a.Type {
	case AnnHighlight, AnnNote, AnnSquare, AnnInk, AnnText, AnnCircle, AnnLine:
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
	if a.BorderWidth < 0 || a.BorderWidth > maxBorderWidth {
		return fmt.Errorf("%w: borderWidth must be 0..%d", ErrInvalidInput, maxBorderWidth)
	}
	return validateAnnotationByType(a)
}

// validateAnnotationByType applies the type-specific rules.
func validateAnnotationByType(a Annotation) error {
	switch a.Type {
	case AnnInk:
		if len(a.Paths) == 0 {
			return fmt.Errorf("%w: ink annotation needs at least one path", ErrInvalidInput)
		}
		for i, p := range a.Paths {
			if len(p) < 4 || len(p)%2 != 0 {
				return fmt.Errorf("%w: ink path %d must be an even list of at least 4 coords", ErrInvalidInput, i+1)
			}
		}

	case AnnText:
		if a.Contents == "" {
			return fmt.Errorf("%w: text annotation needs non-empty contents", ErrInvalidInput)
		}
		if a.FontSize < MinFontSize || a.FontSize > MaxFontSize {
			return fmt.Errorf("%w: fontSize must be %d..%d", ErrInvalidInput, MinFontSize, MaxFontSize)
		}
		if a.Bg != "" && !hexColor.MatchString(a.Bg) {
			return fmt.Errorf("%w: bg must be #RRGGBB, got %q", ErrInvalidInput, a.Bg)
		}

	case AnnLine:
		if len(a.Line) != 4 {
			return fmt.Errorf("%w: line annotation needs line=[x1,y1,x2,y2]", ErrInvalidInput)
		}
		if a.Line[0] == a.Line[2] && a.Line[1] == a.Line[3] {
			return fmt.Errorf("%w: line endpoints must differ", ErrInvalidInput)
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
