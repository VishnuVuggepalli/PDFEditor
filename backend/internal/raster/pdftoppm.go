// Package raster renders PDF pages to images by shelling out to pdftoppm
// (poppler-utils). It is a leaf utility package: it knows nothing about
// documents, only bytes in → image bytes out.
package raster

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image/png"
	"math"
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

// PagePNG renders one 1-based page of pdf as a PNG at least width pixels
// wide (height proportional). The PDF is staged in a temp file because
// pdftoppm wants a seekable input; the single-page PNG arrives on stdout
// (pdftoppm writes to stdout when no output prefix is given).
//
// pdftoppm's -scale-to-x applies to the page's PRE-rotation x axis, so a
// page with /Rotate 90 or 270 gets the requested width on what ends up
// being the output's HEIGHT. When that leaves the output narrower than
// requested (under-resolved), the page is re-rendered proportionally
// larger so the returned raster is never softer than asked for.
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

	out, err := p.renderPage(ctx, tmp.Name(), page, width)
	if err != nil {
		return nil, err
	}

	cfg, err := png.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		return nil, fmt.Errorf("raster: decode rendered png header for page %d: %w", page, err)
	}
	if cfg.Width >= width {
		return out, nil
	}

	// Orientation flip under-resolved the output (e.g. landscape MediaBox +
	// /Rotate 90 displays portrait). Scaling is linear, so retarget
	// -scale-to-x by the shortfall ratio to land the requested final width,
	// aiming one pixel high to absorb pdftoppm's internal rounding.
	scaleToX := int(math.Ceil(float64(width+1) * float64(width) / float64(cfg.Width)))
	return p.renderPage(ctx, tmp.Name(), page, scaleToX)
}

// renderPage invokes pdftoppm once for a single page with -scale-to-x and
// returns the PNG bytes from stdout.
func (p *PDFToPPM) renderPage(ctx context.Context, path string, page, scaleToX int) ([]byte, error) {
	n := strconv.Itoa(page)
	cmd := exec.CommandContext(ctx, p.bin,
		"-png",
		"-f", n, "-l", n,
		"-scale-to-x", strconv.Itoa(scaleToX),
		"-scale-to-y", "-1",
		path,
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

	b := out.Bytes()
	if !bytes.HasPrefix(b, pngMagic) {
		return nil, fmt.Errorf("raster: pdftoppm produced no PNG for page %d (stderr: %s)",
			page, strings.TrimSpace(errBuf.String()))
	}
	return b, nil
}
