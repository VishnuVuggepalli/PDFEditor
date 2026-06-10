package pdf

import (
	"bytes"
	"fmt"
	"io"
	"strconv"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// selectors converts 1-based page numbers to pdfcpu page-selector strings.
func selectors(pages []int) []string {
	out := make([]string, len(pages))
	for i, p := range pages {
		out[i] = strconv.Itoa(p)
	}
	return out
}

// Rotate rotates the given pages clockwise by degrees.
func (e *Engine) Rotate(pdf []byte, pages []int, degrees int) ([]byte, error) {
	var buf bytes.Buffer
	if err := api.Rotate(bytes.NewReader(pdf), &buf, degrees, selectors(pages), e.conf); err != nil {
		return nil, fmt.Errorf("pdfcpu rotate: %w", err)
	}
	return buf.Bytes(), nil
}

// DeletePages removes the given pages.
func (e *Engine) DeletePages(pdf []byte, pages []int) ([]byte, error) {
	var buf bytes.Buffer
	if err := api.RemovePages(bytes.NewReader(pdf), &buf, selectors(pages), e.conf); err != nil {
		return nil, fmt.Errorf("pdfcpu remove pages: %w", err)
	}
	return buf.Bytes(), nil
}

// Reorder rearranges pages into the given order using pdfcpu Collect, which
// assembles a document from a page selection in selection order.
func (e *Engine) Reorder(pdf []byte, order []int) ([]byte, error) {
	var buf bytes.Buffer
	if err := api.Collect(bytes.NewReader(pdf), &buf, selectors(order), e.conf); err != nil {
		return nil, fmt.Errorf("pdfcpu collect: %w", err)
	}
	return buf.Bytes(), nil
}

// Merge concatenates the given PDFs in order.
func (e *Engine) Merge(pdfs [][]byte) ([]byte, error) {
	readers := make([]io.ReadSeeker, len(pdfs))
	for i, b := range pdfs {
		readers[i] = bytes.NewReader(b)
	}
	var buf bytes.Buffer
	if err := api.MergeRaw(readers, &buf, false, e.conf); err != nil {
		return nil, fmt.Errorf("pdfcpu merge: %w", err)
	}
	return buf.Bytes(), nil
}

// ExtractPages produces a new PDF containing only the given pages, using
// pdfcpu Trim.
func (e *Engine) ExtractPages(pdf []byte, pages []int) ([]byte, error) {
	var buf bytes.Buffer
	if err := api.Trim(bytes.NewReader(pdf), &buf, selectors(pages), e.conf); err != nil {
		return nil, fmt.Errorf("pdfcpu trim: %w", err)
	}
	return buf.Bytes(), nil
}

// InsertBlankPages inserts count blank pages before (or after) the given
// 1-based page. size names a pdfcpu paper size ("A4", "Letter", …); empty
// inherits the dimensions of the page at the insertion point.
func (e *Engine) InsertBlankPages(pdf []byte, page int, before bool, count int, size string) ([]byte, error) {
	var pageConf *pdfcpu.PageConfiguration
	if size != "" {
		dim, ok := types.PaperSize[size]
		if !ok {
			return nil, fmt.Errorf("%w: unknown page size %q", document.ErrInvalidInput, size)
		}
		pageConf = &pdfcpu.PageConfiguration{PageDim: dim, PageSize: size, UserDim: true, InpUnit: types.POINTS}
	}

	// api.InsertPages inserts one blank per selected page, so insert one at a
	// time; repeated inserts at the same position just stack identical blanks.
	cur := pdf
	sel := []string{strconv.Itoa(page)}
	for i := 0; i < count; i++ {
		// api.InsertPages mutates conf.Cmd; keep the shared config untouched.
		conf := *e.conf
		var buf bytes.Buffer
		if err := api.InsertPages(bytes.NewReader(cur), &buf, sel, before, pageConf, &conf); err != nil {
			return nil, fmt.Errorf("pdfcpu insert pages: %w", err)
		}
		cur = buf.Bytes()
	}
	return cur, nil
}

// compile-time check: Engine satisfies the domain interface.
var _ document.Engine = (*Engine)(nil)
