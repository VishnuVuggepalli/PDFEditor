package pdf

import (
	"bytes"
	"fmt"
	"image"
	"strconv"

	// Register decoders so image.DecodeConfig can size PNG/JPEG stamps.
	_ "image/jpeg"
	_ "image/png"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// stampGeometry computes the absolute scale factor and lower-left offset
// that fit an imgW×imgH pixel image into rect (PDF points), centered, with
// the aspect ratio preserved. pdfcpu treats 1 image pixel as 1 point at
// scale 1, so scale = targetPoints / imagePixels.
func stampGeometry(rect [4]float64, imgW, imgH int) (scale, dx, dy float64, err error) {
	rw := rect[2] - rect[0]
	rh := rect[3] - rect[1]
	if rw <= 0 || rh <= 0 || imgW <= 0 || imgH <= 0 {
		return 0, 0, 0, fmt.Errorf("degenerate stamp geometry: rect %v image %dx%d", rect, imgW, imgH)
	}
	scale = rw / float64(imgW)
	if s := rh / float64(imgH); s < scale {
		scale = s
	}
	dx = rect[0] + (rw-scale*float64(imgW))/2
	dy = rect[1] + (rh-scale*float64(imgH))/2
	return scale, dx, dy, nil
}

// StampImage draws img (PNG/JPEG, pre-validated by the domain layer) on top
// of the given 1-based page, fitted into rect with aspect ratio preserved.
// Implemented as a pdfcpu image watermark with onTop=true (a "stamp").
func (e *Engine) StampImage(pdf []byte, page int, rect [4]float64, img []byte) ([]byte, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(img))
	if err != nil {
		return nil, fmt.Errorf("decode image dimensions: %w", err)
	}
	scale, dx, dy, err := stampGeometry(rect, cfg.Width, cfg.Height)
	if err != nil {
		return nil, err
	}

	// Anchor bottom-left, then offset to the rect's computed lower-left.
	// Offsets are relative to the page's visible (crop) box lower-left,
	// which is (0,0) for the common case of an unshifted media box.
	desc := fmt.Sprintf("position:bl, offset:%.2f %.2f, scalefactor:%.5f abs, rotation:0, opacity:1",
		dx, dy, scale)
	wm, err := api.ImageWatermarkForReader(bytes.NewReader(img), desc, true, false, types.POINTS)
	if err != nil {
		return nil, fmt.Errorf("pdfcpu image stamp: %w", err)
	}

	var buf bytes.Buffer
	if err := api.AddWatermarks(bytes.NewReader(pdf), &buf, []string{strconv.Itoa(page)}, wm, e.conf); err != nil {
		return nil, fmt.Errorf("pdfcpu add stamp: %w", err)
	}
	return buf.Bytes(), nil
}
