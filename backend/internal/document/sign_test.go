package document

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// fakeSigner appends a marker so tests can see the signed bytes were stored.
type fakeSigner struct {
	err error
}

func (f *fakeSigner) Name() string { return "Test Signer" }

func (f *fakeSigner) Sign(pdf []byte, req SignRequest) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	return append(append([]byte{}, pdf...), []byte("|signed")...), nil
}

// fakeValidator returns canned signature reports.
type fakeValidator struct {
	infos []SignatureInfo
	err   error
}

func (f *fakeValidator) ValidateSignatures(pdf []byte) ([]SignatureInfo, error) {
	return f.infos, f.err
}

func newSignService(pageCount int) (*Service, *fakeStore, *fakeValidator) {
	st := newFakeStore()
	val := &fakeValidator{}
	svc := NewService(st, &fakeEngine{info: PDFInfo{PageCount: pageCount}})
	svc.SetSigning(&fakeSigner{}, val)
	return svc, st, val
}

func TestSignValidation(t *testing.T) {
	ctx := context.Background()
	long := strings.Repeat("x", MaxSignFieldBytes+1)

	tests := []struct {
		name string
		req  SignRequest
	}{
		{"oversized reason", SignRequest{Reason: long}},
		{"oversized location", SignRequest{Location: long}},
		{"visible page zero", SignRequest{Visible: true, Page: 0, Rect: [4]float64{0, 0, 10, 10}}},
		{"visible page beyond count", SignRequest{Visible: true, Page: 3, Rect: [4]float64{0, 0, 10, 10}}},
		{"visible inverted rect", SignRequest{Visible: true, Page: 1, Rect: [4]float64{10, 0, 0, 10}}},
		{"visible zero-area rect", SignRequest{Visible: true, Page: 1, Rect: [4]float64{5, 5, 5, 10}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _, _ := newSignService(2)
			doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

			_, err := svc.Sign(ctx, doc.ID, tt.req)
			if !errors.Is(err, ErrInvalidInput) {
				t.Errorf("want ErrInvalidInput, got %v", err)
			}
		})
	}
}

func TestSignCreatesVersion(t *testing.T) {
	ctx := context.Background()
	svc, st, _ := newSignService(2)
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	got, err := svc.Sign(ctx, doc.ID, SignRequest{Reason: "approval"})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if got.HeadVersion != 2 {
		t.Errorf("head version = %d, want 2", got.HeadVersion)
	}
	if ops := got.Versions[len(got.Versions)-1].Ops; ops != "digitally signed" {
		t.Errorf("ops summary = %q, want %q", ops, "digitally signed")
	}
	b, _ := st.VersionBytes(ctx, doc.ID, 2)
	if !strings.HasSuffix(string(b), "|signed") {
		t.Error("stored head version is not the signed bytes")
	}
}

func TestSignErrors(t *testing.T) {
	ctx := context.Background()

	t.Run("unknown document", func(t *testing.T) {
		svc, _, _ := newSignService(2)
		_, err := svc.Sign(ctx, "nope", SignRequest{})
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("want ErrNotFound, got %v", err)
		}
	})

	t.Run("no signer configured", func(t *testing.T) {
		svc := NewService(newFakeStore(), &fakeEngine{info: PDFInfo{PageCount: 1}})
		doc, _ := svc.Upload(ctx, "a.pdf", validPDF)
		_, err := svc.Sign(ctx, doc.ID, SignRequest{})
		if !errors.Is(err, ErrSigningUnavailable) {
			t.Errorf("want ErrSigningUnavailable, got %v", err)
		}
	})

	t.Run("signer failure propagates", func(t *testing.T) {
		st := newFakeStore()
		svc := NewService(st, &fakeEngine{info: PDFInfo{PageCount: 1}})
		boom := errors.New("boom")
		svc.SetSigning(&fakeSigner{err: boom}, &fakeValidator{})
		doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

		_, err := svc.Sign(ctx, doc.ID, SignRequest{})
		if !errors.Is(err, boom) {
			t.Errorf("want signer error, got %v", err)
		}
		if got, _ := svc.Get(ctx, doc.ID); got.HeadVersion != 1 {
			t.Errorf("failed sign must not create a version, head = %d", got.HeadVersion)
		}
	})
}

func TestSignaturesReporting(t *testing.T) {
	ctx := context.Background()

	t.Run("empty when none", func(t *testing.T) {
		svc, _, val := newSignService(1)
		val.infos = nil
		doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

		infos, err := svc.Signatures(ctx, doc.ID)
		if err != nil {
			t.Fatalf("Signatures: %v", err)
		}
		if infos == nil || len(infos) != 0 {
			t.Errorf("want non-nil empty slice, got %#v", infos)
		}
	})

	t.Run("passes through reports", func(t *testing.T) {
		svc, _, val := newSignService(1)
		val.infos = []SignatureInfo{{Signer: "Test Signer", Valid: true, Status: SigStatusValid}}
		doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

		infos, err := svc.Signatures(ctx, doc.ID)
		if err != nil {
			t.Fatalf("Signatures: %v", err)
		}
		if len(infos) != 1 || infos[0].Signer != "Test Signer" {
			t.Errorf("unexpected reports %#v", infos)
		}
	})

	t.Run("unknown document", func(t *testing.T) {
		svc, _, _ := newSignService(1)
		_, err := svc.Signatures(ctx, "nope")
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("want ErrNotFound, got %v", err)
		}
	})

	t.Run("no validator configured", func(t *testing.T) {
		svc := NewService(newFakeStore(), &fakeEngine{info: PDFInfo{PageCount: 1}})
		doc, _ := svc.Upload(ctx, "a.pdf", validPDF)
		_, err := svc.Signatures(ctx, doc.ID)
		if !errors.Is(err, ErrSigningUnavailable) {
			t.Errorf("want ErrSigningUnavailable, got %v", err)
		}
	})
}
