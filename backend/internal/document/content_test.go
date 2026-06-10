package document

import (
	"bytes"
	"context"
	"errors"
	"testing"
)

func TestReplaceContent(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		id      string
		pdf     []byte
		wantErr error
	}{
		{name: "valid pdf creates a version", id: "", pdf: validPDF},
		{name: "empty bytes rejected", id: "", pdf: nil, wantErr: ErrInvalidInput},
		{name: "oversize rejected", id: "", pdf: append([]byte("%PDF-"), make([]byte, MaxContentPDFBytes)...), wantErr: ErrInvalidInput},
		{name: "invalid pdf rejected", id: "", pdf: []byte("not a pdf"), wantErr: ErrInvalidPDF},
		{name: "unknown document", id: "nope", pdf: validPDF, wantErr: ErrNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, st := newTestService()
			doc, err := svc.Upload(ctx, "a.pdf", validPDF)
			if err != nil {
				t.Fatalf("seed upload: %v", err)
			}
			id := tt.id
			if id == "" {
				id = doc.ID
			}

			edited := tt.pdf
			got, err := svc.ReplaceContent(ctx, id, edited)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				// nothing persisted on failure
				if d, _ := st.Get(ctx, doc.ID); d.HeadVersion != 1 {
					t.Fatalf("head version advanced to %d on failed edit", d.HeadVersion)
				}
				return
			}
			if err != nil {
				t.Fatalf("ReplaceContent: %v", err)
			}
			if got.HeadVersion != 2 {
				t.Fatalf("head version = %d, want 2", got.HeadVersion)
			}
			if ops := got.Versions[len(got.Versions)-1].Ops; ops != "content edit" {
				t.Fatalf("ops = %q, want %q", ops, "content edit")
			}
			b, err := st.VersionBytes(ctx, doc.ID, 2)
			if err != nil {
				t.Fatalf("version bytes: %v", err)
			}
			if !bytes.Equal(b, edited) {
				t.Fatalf("stored bytes differ from uploaded edit")
			}
		})
	}
}
