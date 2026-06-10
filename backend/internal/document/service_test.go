package document

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

// fakeStore is an in-memory document.Store for service tests.
type fakeStore struct {
	docs  map[string]*Document
	bytes map[string][]byte // key: id/vN
	next  int
}

func newFakeStore() *fakeStore {
	return &fakeStore{docs: map[string]*Document{}, bytes: map[string][]byte{}}
}

func (f *fakeStore) key(id string, n int) string { return fmt.Sprintf("%s/v%d", id, n) }

func (f *fakeStore) Create(_ context.Context, name string, pdf []byte) (*Document, error) {
	f.next++
	id := fmt.Sprintf("doc-%d", f.next)
	doc := &Document{ID: id, Name: name, HeadVersion: 1, Versions: []Version{{N: 1, Ops: "upload"}}}
	f.docs[id] = doc
	f.bytes[f.key(id, 1)] = pdf
	return doc, nil
}

func (f *fakeStore) Get(_ context.Context, id string) (*Document, error) {
	d, ok := f.docs[id]
	if !ok {
		return nil, ErrNotFound
	}
	return d, nil
}

func (f *fakeStore) List(_ context.Context) ([]*Document, error) {
	out := make([]*Document, 0, len(f.docs))
	for _, d := range f.docs {
		out = append(out, d)
	}
	return out, nil
}

func (f *fakeStore) VersionBytes(_ context.Context, id string, n int) ([]byte, error) {
	b, ok := f.bytes[f.key(id, n)]
	if !ok {
		return nil, ErrNotFound
	}
	return b, nil
}

func (f *fakeStore) AddVersion(_ context.Context, id string, pdf []byte, ops string) (*Document, error) {
	d, ok := f.docs[id]
	if !ok {
		return nil, ErrNotFound
	}
	d.HeadVersion++
	d.Versions = append(d.Versions, Version{N: d.HeadVersion, Ops: ops})
	f.bytes[f.key(id, d.HeadVersion)] = pdf
	return d, nil
}

// fakeEngine validates by prefix and returns canned info.
type fakeEngine struct{ info PDFInfo }

func (f *fakeEngine) Validate(pdf []byte) error {
	if len(pdf) < 5 || string(pdf[:5]) != "%PDF-" {
		return ErrInvalidPDF
	}
	return nil
}

func (f *fakeEngine) Info(pdf []byte) (PDFInfo, error) { return f.info, nil }

var validPDF = []byte("%PDF-1.7 fake")

func newTestService() (*Service, *fakeStore) {
	st := newFakeStore()
	return NewService(st, &fakeEngine{info: PDFInfo{PageCount: 3}}), st
}

func TestUpload(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()

	tests := []struct {
		name    string
		docName string
		data    []byte
		wantErr error
	}{
		{"valid upload", "a.pdf", validPDF, nil},
		{"empty name", "", validPDF, ErrInvalidInput},
		{"invalid pdf", "b.pdf", []byte("nope"), ErrInvalidPDF},
		{"empty data", "c.pdf", nil, ErrInvalidPDF},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			doc, err := svc.Upload(ctx, tt.docName, tt.data)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("want %v, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Upload: %v", err)
			}
			if doc.HeadVersion != 1 {
				t.Errorf("want head=1, got %d", doc.HeadVersion)
			}
		})
	}
}

func TestDownloadAndMeta(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	b, got, err := svc.Download(ctx, doc.ID)
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if string(b) != string(validPDF) || got.ID != doc.ID {
		t.Error("download returned wrong bytes or doc")
	}

	meta, err := svc.Meta(ctx, doc.ID)
	if err != nil {
		t.Fatalf("Meta: %v", err)
	}
	if meta.PDF.PageCount != 3 {
		t.Errorf("want pageCount=3 from engine, got %d", meta.PDF.PageCount)
	}

	if _, _, err := svc.Download(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestRestoreVersion(t *testing.T) {
	svc, st := newTestService()
	ctx := context.Background()
	doc, _ := svc.Upload(ctx, "a.pdf", validPDF)

	v2 := []byte("%PDF-1.7 v2")
	if _, err := st.AddVersion(ctx, doc.ID, v2, "edit"); err != nil {
		t.Fatal(err)
	}

	restored, err := svc.RestoreVersion(ctx, doc.ID, 1)
	if err != nil {
		t.Fatalf("RestoreVersion: %v", err)
	}
	if restored.HeadVersion != 3 {
		t.Errorf("restore should create v3, got head=%d", restored.HeadVersion)
	}
	b, _ := svc.DownloadVersion(ctx, doc.ID, 3)
	if string(b) != string(validPDF) {
		t.Error("restored head should hold v1 bytes")
	}

	if _, err := svc.RestoreVersion(ctx, doc.ID, 99); !errors.Is(err, ErrNotFound) {
		t.Errorf("want ErrNotFound for missing version, got %v", err)
	}
}
