package document

import (
	"bytes"
	"context"
	"errors"
	"testing"
)

// tinyPNG returns bytes with a valid PNG signature (content irrelevant for
// the domain layer, which only checks magic bytes and size).
func tinyPNG() []byte {
	return append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, []byte("fakepng")...)
}

func tinyJPEG() []byte {
	return append([]byte{0xff, 0xd8, 0xff, 0xe0}, []byte("fakejpg")...)
}

var goodRect = [4]float64{100, 100, 300, 200}

func TestStampImageValidation(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name string
		page int
		rect [4]float64
		img  []byte
	}{
		{"empty image", 1, goodRect, nil},
		{"oversized image", 1, goodRect, append(tinyPNG(), bytes.Repeat([]byte{0}, MaxStampImageBytes)...)},
		{"wrong magic bytes", 1, goodRect, []byte("GIF89a not allowed")},
		{"page zero", 0, goodRect, tinyPNG()},
		{"page beyond count", 99, goodRect, tinyPNG()},
		{"inverted rect", 1, [4]float64{300, 100, 100, 200}, tinyPNG()},
		{"zero-area rect", 1, [4]float64{100, 100, 100, 200}, tinyPNG()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _, _ := newPageOpsService(2)
			doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

			_, err := svc.StampImage(ctx, doc.ID, tt.page, tt.rect, tt.img)
			if !errors.Is(err, ErrInvalidInput) {
				t.Errorf("want ErrInvalidInput, got %v", err)
			}
		})
	}
}

func TestStampImageCreatesVersion(t *testing.T) {
	ctx := context.Background()

	for _, tt := range []struct {
		name string
		img  []byte
	}{
		{"png", tinyPNG()},
		{"jpeg", tinyJPEG()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			svc, _, eng := newPageOpsService(3)
			doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

			updated, err := svc.StampImage(ctx, doc.ID, 3, goodRect, tt.img)
			if err != nil {
				t.Fatalf("StampImage: %v", err)
			}
			if updated.HeadVersion != 2 {
				t.Errorf("want head=2, got %d", updated.HeadVersion)
			}
			if updated.Head().Ops != "signature stamp p3" {
				t.Errorf("ops summary: %q", updated.Head().Ops)
			}
			if len(eng.applied) != 1 || eng.applied[0] != "stamp_p3" {
				t.Errorf("engine calls: %v", eng.applied)
			}
		})
	}
}

func TestStampImageUnknownDocument(t *testing.T) {
	svc, _, _ := newPageOpsService(1)
	_, err := svc.StampImage(context.Background(), "missing", 1, goodRect, tinyPNG())
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}
