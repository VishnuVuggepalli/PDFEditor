package pdf

import (
	"bytes"
	"fmt"
	"strconv"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/color"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// parseHexColor converts "#RRGGBB" to a pdfcpu SimpleColor. Input format is
// validated by the domain layer; errors here guard against direct misuse.
func parseHexColor(s string) (*color.SimpleColor, error) {
	if len(s) != 7 || s[0] != '#' {
		return nil, fmt.Errorf("bad color %q", s)
	}
	n, err := strconv.ParseUint(s[1:], 16, 32)
	if err != nil {
		return nil, fmt.Errorf("bad color %q: %w", s, err)
	}
	return &color.SimpleColor{
		R: float32((n>>16)&0xff) / 255,
		G: float32((n>>8)&0xff) / 255,
		B: float32(n&0xff) / 255,
	}, nil
}

// renderer builds the pdfcpu annotation for one domain annotation.
func renderer(a document.Annotation) (model.AnnotationRenderer, error) {
	col, err := parseHexColor(a.Color)
	if err != nil {
		return nil, err
	}
	rect := types.NewRectangle(a.Rect[0], a.Rect[1], a.Rect[2], a.Rect[3])

	var ca *float64
	if a.Opacity > 0 && a.Opacity < 1 {
		ca = &a.Opacity
	}

	switch a.Type {
	case document.AnnHighlight:
		quad := types.QuadPoints{*types.NewQuadLiteralForRect(rect)}
		return model.NewHighlightAnnotation(
			*rect, 0, a.Contents, "", "", 0, col,
			0, 0, 0, "", nil, ca, "", "", quad), nil

	case document.AnnNote:
		return model.NewTextAnnotation(
			*rect, 0, a.Contents, "", "", 0, col,
			"", nil, ca, "", "",
			0, 0, 0, false, "Comment"), nil

	case document.AnnSquare:
		return model.NewSquareAnnotation(
			*rect, 0, a.Contents, "", "", 0, col,
			"", nil, ca, "", "",
			nil, 0, 0, 0, 0, 1, model.BSSolid, false, 0), nil

	case document.AnnInk:
		ink := make([]model.InkPath, len(a.Paths))
		for i, p := range a.Paths {
			ink[i] = model.InkPath(p)
		}
		return model.NewInkAnnotation(
			*rect, 0, a.Contents, "", "", 0, col,
			"", nil, ca, "", "",
			ink, 1, model.BSSolid), nil

	default:
		return nil, fmt.Errorf("unknown annotation type %q", a.Type)
	}
}

// Annotate embeds annotations into the PDF, grouped per page.
func (e *Engine) Annotate(pdf []byte, annots []document.Annotation) ([]byte, error) {
	byPage := make(map[int][]model.AnnotationRenderer, len(annots))
	for _, a := range annots {
		r, err := renderer(a)
		if err != nil {
			return nil, fmt.Errorf("build annotation: %w", err)
		}
		byPage[a.Page] = append(byPage[a.Page], r)
	}

	var buf bytes.Buffer
	if err := api.AddAnnotationsMap(bytes.NewReader(pdf), &buf, byPage, e.conf); err != nil {
		return nil, fmt.Errorf("pdfcpu add annotations: %w", err)
	}
	return buf.Bytes(), nil
}
