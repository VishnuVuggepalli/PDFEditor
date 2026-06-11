package pdf

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/sign"
)

func signFixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "sample.pdf"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return b
}

// newTrustedSigner generates a fresh identity and registers it with the
// engine's trust pool, mirroring the startup wiring.
func newTrustedSigner(t *testing.T, e *Engine) *sign.Signer {
	t.Helper()
	id, err := sign.LoadOrCreateIdentity(filepath.Join(t.TempDir(), "keys"))
	if err != nil {
		t.Fatalf("identity: %v", err)
	}
	if err := e.TrustCert(id.Cert); err != nil {
		t.Fatalf("TrustCert: %v", err)
	}
	return sign.New(id)
}

func TestValidateSignaturesNoSignatures(t *testing.T) {
	e := NewEngine()
	infos, err := e.ValidateSignatures(signFixture(t))
	if err != nil {
		t.Fatalf("ValidateSignatures: %v", err)
	}
	if len(infos) != 0 {
		t.Errorf("want no signatures on unsigned doc, got %d", len(infos))
	}
}

func TestSignedDocumentValidates(t *testing.T) {
	e := NewEngine()
	signer := newTrustedSigner(t, e)

	tests := []struct {
		name        string
		req         document.SignRequest
		wantVisible bool
		wantPage    int
	}{
		{"invisible", document.SignRequest{Reason: "I approve", Location: "home office"}, false, 0},
		{"visible", document.SignRequest{Visible: true, Page: 1, Rect: [4]float64{100, 100, 320, 170}}, true, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			signed, err := signer.Sign(signFixture(t), tt.req)
			if err != nil {
				t.Fatalf("Sign: %v", err)
			}

			infos, err := e.ValidateSignatures(signed)
			if err != nil {
				t.Fatalf("ValidateSignatures: %v", err)
			}
			if len(infos) != 1 {
				t.Fatalf("want 1 signature, got %d: %+v", len(infos), infos)
			}
			got := infos[0]

			if !got.Valid || got.Status != document.SigStatusValid {
				t.Errorf("want valid signature, got valid=%t status=%q reason=%q", got.Valid, got.Status, got.Reason)
			}
			if got.Signer != signer.Name() {
				t.Errorf("signer = %q, want %q", got.Signer, signer.Name())
			}
			if !got.CoversWholeDocument {
				t.Error("single signature should cover the whole document")
			}
			if got.SignedAt.IsZero() {
				t.Error("missing signing time")
			}
			if !got.SelfSigned {
				t.Error("generated identity should be reported self-signed")
			}
			if got.Visible != tt.wantVisible || got.Page != tt.wantPage {
				t.Errorf("visible=%t page=%d, want visible=%t page=%d", got.Visible, got.Page, tt.wantVisible, tt.wantPage)
			}
			if got.SigningReason != tt.req.Reason || got.Location != tt.req.Location {
				t.Errorf("reason/location = %q/%q, want %q/%q", got.SigningReason, got.Location, tt.req.Reason, tt.req.Location)
			}
		})
	}
}

// TestTamperedSignatureReportsInvalid is the tamper test: flip one byte of
// signed content and the signature must no longer validate.
func TestTamperedSignatureReportsInvalid(t *testing.T) {
	e := NewEngine()
	signer := newTrustedSigner(t, e)

	signed, err := signer.Sign(signFixture(t), document.SignRequest{Reason: "tamper test"})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	// Flip a byte inside the first content stream — within the signed
	// ByteRange but harmless to the file structure, so parsing still works
	// and the digest check is what fails.
	idx := bytes.Index(signed, []byte("stream"))
	if idx < 0 || idx+32 >= len(signed) {
		t.Fatal("fixture has no content stream to tamper with")
	}
	tampered := append([]byte(nil), signed...)
	tampered[idx+16] ^= 0xff

	infos, err := e.ValidateSignatures(tampered)
	if err != nil {
		t.Fatalf("ValidateSignatures on tampered doc: %v", err)
	}
	if len(infos) != 1 {
		t.Fatalf("want 1 signature, got %d", len(infos))
	}
	got := infos[0]
	if got.Valid || got.Status != document.SigStatusInvalid {
		t.Errorf("tampered doc: want invalid, got valid=%t status=%q reason=%q", got.Valid, got.Status, got.Reason)
	}
}

// TestUntrustedSignerReportsUnknown: a signature from an identity that is
// NOT in the local trust pool keeps its digest validity but the signer is
// unknown — the "unknown signer" badge.
func TestUntrustedSignerReportsUnknown(t *testing.T) {
	e := NewEngine()

	id, err := sign.LoadOrCreateIdentity(filepath.Join(t.TempDir(), "keys"))
	if err != nil {
		t.Fatalf("identity: %v", err)
	}
	// Deliberately no TrustCert.
	signed, err := sign.New(id).Sign(signFixture(t), document.SignRequest{})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	infos, err := e.ValidateSignatures(signed)
	if err != nil {
		t.Fatalf("ValidateSignatures: %v", err)
	}
	if len(infos) != 1 {
		t.Fatalf("want 1 signature, got %d", len(infos))
	}
	got := infos[0]
	if got.Valid {
		t.Error("untrusted signer must not be reported valid")
	}
	if got.Status != document.SigStatusUnknown {
		t.Errorf("status = %q, want %q (reason %q)", got.Status, document.SigStatusUnknown, got.Reason)
	}
}

// TestSecondSignatureCoverage: after signing twice, the first signature no
// longer covers the whole document, the second does.
func TestSecondSignatureCoverage(t *testing.T) {
	e := NewEngine()
	signer := newTrustedSigner(t, e)

	once, err := signer.Sign(signFixture(t), document.SignRequest{Reason: "first"})
	if err != nil {
		t.Fatalf("first Sign: %v", err)
	}
	twice, err := signer.Sign(once, document.SignRequest{Reason: "second"})
	if err != nil {
		t.Fatalf("second Sign: %v", err)
	}

	infos, err := e.ValidateSignatures(twice)
	if err != nil {
		t.Fatalf("ValidateSignatures: %v", err)
	}
	if len(infos) != 2 {
		t.Fatalf("want 2 signatures, got %d: %+v", len(infos), infos)
	}

	covering := 0
	for _, info := range infos {
		if info.CoversWholeDocument {
			covering++
		}
	}
	if covering != 1 {
		t.Errorf("want exactly 1 signature covering the whole document, got %d", covering)
	}
}

// TestEditAfterSigningInvalidates mirrors the app's save flow: a pdfcpu
// rewrite (annotation embed) after signing must invalidate or drop the
// signature — the invariant the UI warns about.
func TestEditAfterSigningInvalidates(t *testing.T) {
	e := NewEngine()
	signer := newTrustedSigner(t, e)

	signed, err := signer.Sign(signFixture(t), document.SignRequest{})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	edited, err := e.Annotate(signed, []document.Annotation{{
		Type: "note", Page: 1, Rect: [4]float64{50, 50, 70, 70}, Color: "#ff0000", Contents: "post-sign edit",
	}})
	if err != nil {
		t.Fatalf("Annotate signed doc: %v", err)
	}

	infos, err := e.ValidateSignatures(edited)
	if err != nil {
		t.Fatalf("ValidateSignatures: %v", err)
	}
	for _, info := range infos {
		if info.Valid {
			t.Errorf("signature still valid after edit: %+v", info)
		}
		if info.Status != document.SigStatusInvalid {
			t.Errorf("post-edit status = %q (reason %q), want %q", info.Status, info.Reason, document.SigStatusInvalid)
		}
	}
}
