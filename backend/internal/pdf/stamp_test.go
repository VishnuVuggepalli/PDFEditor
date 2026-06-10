package pdf

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"testing"
)

// testPNG renders a small opaque PNG in memory.
func testPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 20, G: 40, B: 160, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func TestStampGeometry(t *testing.T) {
	tests := []struct {
		name          string
		rect          [4]float64
		imgW, imgH    int
		scale, dx, dy float64
		wantErr       bool
	}{
		// wide image into wide rect: width-limited, vertically centered
		{"width limited", [4]float64{100, 100, 300, 200}, 200, 50, 1.0, 100, 125, false},
		// tall image into the same rect: height-limited, horizontally centered
		{"height limited", [4]float64{100, 100, 300, 200}, 50, 200, 0.5, 187.5, 100, false},
		// exact fit
		{"exact fit", [4]float64{0, 0, 100, 50}, 200, 100, 0.5, 0, 0, false},
		{"zero image", [4]float64{0, 0, 100, 50}, 0, 100, 0, 0, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scale, dx, dy, err := stampGeometry(tt.rect, tt.imgW, tt.imgH)
			if tt.wantErr {
				if err == nil {
					t.Fatal("want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("stampGeometry: %v", err)
			}
			const eps = 1e-9
			if math.Abs(scale-tt.scale) > eps || math.Abs(dx-tt.dx) > eps || math.Abs(dy-tt.dy) > eps {
				t.Errorf("got scale=%v dx=%v dy=%v, want %v %v %v", scale, dx, dy, tt.scale, tt.dx, tt.dy)
			}
		})
	}
}

func TestStampImagePNG(t *testing.T) {
	e := NewEngine()
	src := fixture(t) // 2 pages

	out, err := e.StampImage(src, 2, [4]float64{100, 100, 300, 200}, testPNG(t, 120, 60))
	if err != nil {
		t.Fatalf("StampImage: %v", err)
	}
	if err := e.Validate(out); err != nil {
		t.Fatalf("stamped output invalid: %v", err)
	}
	if n := pageCount(t, e, out); n != 2 {
		t.Errorf("page count changed: %d", n)
	}
	if len(out) <= len(src) {
		t.Error("stamped PDF should be larger than source")
	}
}

func TestStampImageGarbageImage(t *testing.T) {
	e := NewEngine()
	if _, err := e.StampImage(fixture(t), 1, [4]float64{0, 0, 100, 100}, []byte("not an image")); err == nil {
		t.Error("garbage image should fail")
	}
}

func TestStampImageGarbagePDF(t *testing.T) {
	e := NewEngine()
	if _, err := e.StampImage([]byte("%PDF-1.7 garbage"), 1, [4]float64{0, 0, 100, 100}, testPNG(t, 10, 10)); err == nil {
		t.Error("garbage pdf should fail")
	}
}
