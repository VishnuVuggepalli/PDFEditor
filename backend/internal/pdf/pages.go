package pdf

import (
	"bytes"
	"fmt"
	"io"
	"strconv"

	"github.com/pdfcpu/pdfcpu/pkg/api"

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

// compile-time check: Engine satisfies the domain interface.
var _ document.Engine = (*Engine)(nil)
