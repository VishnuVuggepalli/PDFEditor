package sign

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

func testIdentity(t *testing.T) *Identity {
	t.Helper()
	id, err := LoadOrCreateIdentity(filepath.Join(t.TempDir(), "keys"))
	if err != nil {
		t.Fatalf("identity: %v", err)
	}
	return id
}

func samplePDF(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "sample.pdf"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return b
}

func TestSignProducesIncrementalUpdate(t *testing.T) {
	src := samplePDF(t)
	signer := New(testIdentity(t))

	tests := []struct {
		name string
		req  document.SignRequest
	}{
		{"invisible", document.SignRequest{Reason: "approval", Location: "home"}},
		{"visible widget", document.SignRequest{Visible: true, Page: 1, Rect: [4]float64{100, 100, 300, 160}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := signer.Sign(src, tt.req)
			if err != nil {
				t.Fatalf("Sign: %v", err)
			}
			if len(out) <= len(src) {
				t.Fatalf("signed output %d bytes, want > input %d", len(out), len(src))
			}
			// Incremental update: the original bytes must be a prefix, so
			// any signature over them stays verifiable.
			if !bytes.HasPrefix(out, src) {
				t.Error("signed output does not start with the original bytes (not an incremental update)")
			}
			if !bytes.Contains(out[len(src):], []byte("adbe.pkcs7.detached")) {
				t.Error("appended increment lacks a PKCS#7 detached signature dict")
			}
		})
	}
}

func TestSignRejectsGarbage(t *testing.T) {
	signer := New(testIdentity(t))
	_, err := signer.Sign([]byte("not a pdf"), document.SignRequest{})
	if !errors.Is(err, ErrSign) {
		t.Errorf("want ErrSign for garbage input, got %v", err)
	}
}
