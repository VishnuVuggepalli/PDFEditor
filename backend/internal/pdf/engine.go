// Package pdf wraps the pdfcpu library behind the document.Engine interface.
// This is the ONLY package in the codebase allowed to import pdfcpu, so the
// engine can be swapped (e.g. for mupdf in a later phase) by replacing one
// package.
package pdf

import (
	"bytes"
	"fmt"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// header is the magic-byte prefix every PDF must start with (within the
// first 1024 bytes per spec, but in practice at offset 0).
var header = []byte("%PDF-")

// Engine implements document.Engine using pdfcpu.
type Engine struct {
	conf *model.Configuration
}

// maxDecompressedBytes caps both encoded stream bytes read from a PDF and
// decoded bytes produced by filters (pdfcpu defaults are 512MB each), giving
// headroom against decompression-bomb PDFs on a 50MB upload limit.
const maxDecompressedBytes = 200 << 20 // 200MB

// NewEngine returns an Engine with pdfcpu's relaxed default configuration,
// which tolerates the minor spec violations common in real-world PDFs, but
// with tightened resource limits against PDF bombs.
func NewEngine() *Engine {
	conf := model.NewDefaultConfiguration()
	conf.Limits.MaxStreamBytes = maxDecompressedBytes
	conf.Limits.MaxDecodeBytes = maxDecompressedBytes
	return &Engine{conf: conf}
}

// Validate checks magic bytes first (cheap), then runs pdfcpu's structural
// validation. All failures wrap document.ErrInvalidPDF.
func (e *Engine) Validate(pdf []byte) error {
	if len(pdf) < len(header) || !bytes.HasPrefix(pdf, header) {
		return fmt.Errorf("%w: missing %%PDF header", document.ErrInvalidPDF)
	}
	if err := api.Validate(bytes.NewReader(pdf), e.conf); err != nil {
		return fmt.Errorf("%w: %v", document.ErrInvalidPDF, err)
	}
	return nil
}

// Info computes PDF-intrinsic metadata from the bytes.
func (e *Engine) Info(pdf []byte) (document.PDFInfo, error) {
	ctx, err := api.ReadContext(bytes.NewReader(pdf), e.conf)
	if err != nil {
		return document.PDFInfo{}, fmt.Errorf("%w: %v", document.ErrInvalidPDF, err)
	}
	if err := api.ValidateContext(ctx); err != nil {
		return document.PDFInfo{}, fmt.Errorf("%w: %v", document.ErrInvalidPDF, err)
	}
	return document.PDFInfo{
		PageCount: ctx.PageCount,
		Encrypted: ctx.Encrypt != nil,
		HasForm:   len(ctx.Form) > 0,
	}, nil
}
