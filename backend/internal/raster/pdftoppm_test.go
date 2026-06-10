package raster

import (
	"bytes"
	"context"
	"errors"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// requirePdftoppm skips when the poppler binary is unavailable (the package
// shells out; there is nothing meaningful to test without it).
func requirePdftoppm(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath(defaultBin); err != nil {
		t.Skipf("%s not installed: %v", defaultBin, err)
	}
}

func fixturePDF(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return b
}

func samplePDF(t *testing.T) []byte {
	t.Helper()
	return fixturePDF(t, "sample.pdf")
}

func TestPagePNG(t *testing.T) {
	requirePdftoppm(t)
	sample := samplePDF(t)
	ctx := context.Background()
	r := New()

	tests := []struct {
		name    string
		pdf     []byte
		page    int
		width   int
		wantErr bool
		oob     bool // expect ErrPageOutOfRange
	}{
		{name: "page 1 at 240", pdf: sample, page: 1, width: 240},
		{name: "page 2 at 64", pdf: sample, page: 2, width: 64},
		{name: "page out of range", pdf: sample, page: 99, width: 240, wantErr: true, oob: true},
		{name: "zero page", pdf: sample, page: 0, width: 240, wantErr: true},
		{name: "zero width", pdf: sample, page: 1, width: 0, wantErr: true},
		{name: "empty pdf", pdf: nil, page: 1, width: 240, wantErr: true},
		{name: "garbage pdf", pdf: []byte("not a pdf"), page: 1, width: 240, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.PagePNG(ctx, tt.pdf, tt.page, tt.width)
			if tt.wantErr {
				if err == nil {
					t.Fatal("want error, got nil")
				}
				if tt.oob && !errors.Is(err, ErrPageOutOfRange) {
					t.Errorf("want ErrPageOutOfRange, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("PagePNG: %v", err)
			}
			if len(out) == 0 {
				t.Fatal("empty PNG output")
			}
			if !bytes.HasPrefix(out, pngMagic) {
				t.Fatalf("output missing PNG magic, starts with %x", out[:min(8, len(out))])
			}
			cfg, err := png.DecodeConfig(bytes.NewReader(out))
			if err != nil {
				t.Fatalf("decode png config: %v", err)
			}
			if cfg.Width != tt.width {
				t.Errorf("rendered width: want %d, got %d", tt.width, cfg.Width)
			}
			if cfg.Height < 1 {
				t.Errorf("rendered height: want >= 1, got %d", cfg.Height)
			}
		})
	}
}

// Pages with /Rotate 90 flip pdftoppm's -scale-to-x onto the output's height
// (the flag applies to the pre-rotation x axis). The renderer must never
// return a raster narrower than requested, whatever the rotation.
func TestPagePNGRotatedPages(t *testing.T) {
	requirePdftoppm(t)
	ctx := context.Background()
	r := New()

	tests := []struct {
		name      string
		fixture   string
		width     int
		landscape bool // expected output orientation
		exact     bool // re-render path targets the requested width exactly-ish
	}{
		// portrait MediaBox + /Rotate 90 displays landscape: -scale-to-x lands
		// on the short side, so the output is naturally wider than requested.
		{name: "portrait base rotated 90", fixture: "rot90-portrait-base.pdf",
			width: 240, landscape: true},
		// landscape MediaBox + /Rotate 90 displays portrait: without the
		// re-render the output would be only width*(595/842) px wide.
		{name: "landscape base rotated 90", fixture: "rot90-landscape-base.pdf",
			width: 240, landscape: false, exact: true},
		{name: "landscape base rotated 90 at 630", fixture: "rot90-landscape-base.pdf",
			width: 630, landscape: false, exact: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.PagePNG(ctx, fixturePDF(t, tt.fixture), 1, tt.width)
			if err != nil {
				t.Fatalf("PagePNG: %v", err)
			}
			cfg, err := png.DecodeConfig(bytes.NewReader(out))
			if err != nil {
				t.Fatalf("decode png config: %v", err)
			}
			if cfg.Width < tt.width {
				t.Errorf("rendered width: want >= %d, got %d (under-resolved)", tt.width, cfg.Width)
			}
			// The re-render retargets the requested width; allow rounding slack.
			if tt.exact && cfg.Width > tt.width+2 {
				t.Errorf("rendered width: want ~%d, got %d (over-rendered)", tt.width, cfg.Width)
			}
			if gotLandscape := cfg.Width > cfg.Height; gotLandscape != tt.landscape {
				t.Errorf("orientation: want landscape=%v, got %dx%d", tt.landscape, cfg.Width, cfg.Height)
			}
		})
	}
}

func TestPagePNGCanceledContext(t *testing.T) {
	requirePdftoppm(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := New().PagePNG(ctx, samplePDF(t), 1, 240); err == nil {
		t.Fatal("want error from canceled context, got nil")
	}
}

func TestPagePNGLeavesNoTempFiles(t *testing.T) {
	requirePdftoppm(t)
	// Point temp files at a private dir so leftovers are detectable.
	tmpDir := t.TempDir()
	t.Setenv("TMPDIR", tmpDir)

	r := New()
	if _, err := r.PagePNG(context.Background(), samplePDF(t), 1, 64); err != nil {
		t.Fatalf("render: %v", err)
	}
	// Failure path must clean up too.
	if _, err := r.PagePNG(context.Background(), []byte("garbage"), 1, 64); err == nil {
		t.Fatal("want error for garbage pdf")
	}

	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatalf("read temp dir: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("temp files leaked: %v", entries)
	}
}
