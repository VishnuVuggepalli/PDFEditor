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

// freeTextRenderer wraps a FreeTextAnnotation to write a complete /DA
// (font + size + color). pdfcpu v0.13's FreeText RenderDict emits only the
// color operator (the Tf part is an upstream TODO), which leaves viewers
// without a usable default appearance.
type freeTextRenderer struct {
	model.FreeTextAnnotation
	da string
}

// RenderDict renders the wrapped annotation, then replaces /DA.
func (r freeTextRenderer) RenderDict(xRefTable *model.XRefTable, pageIndRef *types.IndirectRef) (types.Dict, error) {
	d, err := r.FreeTextAnnotation.RenderDict(xRefTable, pageIndRef)
	if err != nil {
		return nil, err
	}
	d["DA"] = types.StringLiteral(r.da)
	return d, nil
}

// strokeWidth returns the annotation's border width, defaulting to 1.
func strokeWidth(a document.Annotation) float64 {
	if a.BorderWidth > 0 {
		return a.BorderWidth
	}
	return 1
}

// freeText builds the renderer for a "text" annotation: Helvetica (core-14,
// no embedding), left-aligned, optional background color and border.
func freeText(a document.Annotation, fontCol *color.SimpleColor, ca *float64, rect *types.Rectangle) (model.AnnotationRenderer, error) {
	var bg *color.SimpleColor
	if a.Bg != "" {
		c, err := parseHexColor(a.Bg)
		if err != nil {
			return nil, err
		}
		bg = c
	}
	ft := model.NewFreeTextAnnotation(
		*rect, 0, a.Contents, "", "", 0, bg,
		"", nil, ca, "", "",
		a.Contents, types.AlignLeft, "Helvetica", a.FontSize, fontCol,
		"", nil, nil, nil,
		0, 0, 0, 0,
		a.BorderWidth, model.BSSolid, false, 0)
	da := fmt.Sprintf("/Helv %d Tf %.4f %.4f %.4f rg",
		a.FontSize, fontCol.R, fontCol.G, fontCol.B)
	return freeTextRenderer{FreeTextAnnotation: ft, da: da}, nil
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
			nil, 0, 0, 0, 0, strokeWidth(a), model.BSSolid, false, 0), nil

	case document.AnnInk:
		ink := make([]model.InkPath, len(a.Paths))
		for i, p := range a.Paths {
			ink[i] = model.InkPath(p)
		}
		return model.NewInkAnnotation(
			*rect, 0, a.Contents, "", "", 0, col,
			"", nil, ca, "", "",
			ink, 1, model.BSSolid), nil

	case document.AnnText:
		return freeText(a, col, ca, rect)

	case document.AnnCircle:
		return model.NewCircleAnnotation(
			*rect, 0, a.Contents, "", "", 0, col,
			"", nil, ca, "", "",
			nil, 0, 0, 0, 0, strokeWidth(a), model.BSSolid, false, 0), nil

	case document.AnnLine:
		p1 := types.Point{X: a.Line[0], Y: a.Line[1]}
		p2 := types.Point{X: a.Line[2], Y: a.Line[3]}
		return model.NewLineAnnotation(
			*rect, 0, a.Contents, "", "", 0, col,
			"", nil, ca, "", "",
			p1, p2, nil, nil, 0, 0, 0, nil, nil,
			false, false, 0, 0, nil, strokeWidth(a), model.BSSolid), nil

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
