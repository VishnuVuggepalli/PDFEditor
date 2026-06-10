// Package raster renders PDF pages to images by shelling out to pdftoppm
// (poppler-utils). It is a leaf utility package: it knows nothing about
// documents, only bytes in → image bytes out.
package raster

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBin     = "pdftoppm"
	defaultTimeout = 10 * time.Second
)

// ErrPageOutOfRange reports a request for a page the PDF does not have.
var ErrPageOutOfRange = errors.New("page out of range")

// pngMagic is the 8-byte PNG file signature.
var pngMagic = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

// PDFToPPM renders pages by invoking the pdftoppm binary.
type PDFToPPM struct {
	bin     string
	timeout time.Duration
}

// New returns a renderer using the pdftoppm binary from PATH with a
// 10-second per-render timeout.
func New() *PDFToPPM {
	return &PDFToPPM{bin: defaultBin, timeout: defaultTimeout}
}

// PagePNG renders one 1-based page of pdf as a PNG scaled to width pixels
// wide (height proportional). The PDF is staged in a temp file because
// pdftoppm wants a seekable input; the single-page PNG arrives on stdout
// (pdftoppm writes to stdout when no output prefix is given).
func (p *PDFToPPM) PagePNG(ctx context.Context, pdf []byte, page, width int) ([]byte, error) {
	if len(pdf) == 0 {
		return nil, errors.New("raster: empty pdf input")
	}
	if page < 1 {
		return nil, fmt.Errorf("raster: page must be >= 1, got %d", page)
	}
	if width < 1 {
		return nil, fmt.Errorf("raster: width must be >= 1, got %d", width)
	}

	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()

	tmp, err := os.CreateTemp("", "raster-*.pdf")
	if err != nil {
		return nil, fmt.Errorf("raster: create temp pdf: %w", err)
	}
	defer os.Remove(tmp.Name())

	if _, err := tmp.Write(pdf); err != nil {
		tmp.Close()
		return nil, fmt.Errorf("raster: write temp pdf: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return nil, fmt.Errorf("raster: close temp pdf: %w", err)
	}

	n := strconv.Itoa(page)
	cmd := exec.CommandContext(ctx, p.bin,
		"-png",
		"-f", n, "-l", n,
		"-scale-to-x", strconv.Itoa(width),
		"-scale-to-y", "-1",
		tmp.Name(),
	)
	var out, errBuf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errBuf

	if err := cmd.Run(); err != nil {
		stderr := strings.TrimSpace(errBuf.String())
		// pdftoppm exits 99 with this message when -f exceeds the page count.
		if strings.Contains(stderr, "Wrong page range") {
			return nil, fmt.Errorf("%w: page %d", ErrPageOutOfRange, page)
		}
		return nil, fmt.Errorf("raster: pdftoppm page %d: %w (stderr: %s)", page, err, stderr)
	}

	png := out.Bytes()
	if !bytes.HasPrefix(png, pngMagic) {
		return nil, fmt.Errorf("raster: pdftoppm produced no PNG for page %d (stderr: %s)",
			page, strings.TrimSpace(errBuf.String()))
	}
	return png, nil
}
