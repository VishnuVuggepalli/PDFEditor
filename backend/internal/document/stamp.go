package document

import (
	"bytes"
	"context"
	"fmt"
)

// MaxStampImageBytes caps signature image uploads at 5 MB.
const MaxStampImageBytes = 5 << 20

// Image magic-byte prefixes accepted for signature stamps.
var (
	pngMagic  = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	jpegMagic = []byte{0xff, 0xd8, 0xff}
)

// validateStampImage checks size and magic bytes (PNG or JPEG only).
func validateStampImage(img []byte) error {
	if len(img) == 0 {
		return fmt.Errorf("%w: empty image", ErrInvalidInput)
	}
	if len(img) > MaxStampImageBytes {
		return fmt.Errorf("%w: image exceeds %d MB limit", ErrInvalidInput, MaxStampImageBytes>>20)
	}
	if !bytes.HasPrefix(img, pngMagic) && !bytes.HasPrefix(img, jpegMagic) {
		return fmt.Errorf("%w: image must be PNG or JPEG", ErrInvalidInput)
	}
	return nil
}

// StampImage places a signature image onto one page of the head version
// (fitted into rect, aspect preserved) and stores the result as a new version.
// Rect is [llx,lly,urx,ury] in PDF points with a lower-left origin.
func (s *Service) StampImage(ctx context.Context, id string, page int, rect [4]float64, img []byte) (*Document, error) {
	if err := validateStampImage(img); err != nil {
		return nil, err
	}
	if rect[0] >= rect[2] || rect[1] >= rect[3] {
		return nil, fmt.Errorf("%w: rect must be [llx,lly,urx,ury] with llx<urx and lly<ury", ErrInvalidInput)
	}

	cur, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := s.engine.Info(cur)
	if err != nil {
		return nil, fmt.Errorf("read pdf info: %w", err)
	}
	if page < 1 || page > info.PageCount {
		return nil, fmt.Errorf("%w: page %d out of range 1..%d", ErrInvalidInput, page, info.PageCount)
	}

	out, err := s.engine.StampImage(cur, page, rect, img)
	if err != nil {
		return nil, fmt.Errorf("apply signature stamp: %w", err)
	}

	doc, err := s.store.AddVersion(ctx, id, out, fmt.Sprintf("signature stamp p%d", page))
	if err != nil {
		return nil, fmt.Errorf("save new version: %w", err)
	}
	return doc, nil
}
