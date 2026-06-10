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

func (f *fakeStore) Rename(_ context.Context, id string, name string) (*Document, error) {
	d, ok := f.docs[id]
	if !ok {
		return nil, ErrNotFound
	}
	d.Name = name
	return d, nil
}

func (f *fakeStore) Delete(_ context.Context, id string) error {
	if _, ok := f.docs[id]; !ok {
		return ErrNotFound
	}
	delete(f.docs, id)
	return nil
}

// fakeEngine validates by prefix, returns canned info, and records page ops
// by appending markers to the bytes.
type fakeEngine struct {
	info    PDFInfo
	applied []string
}

func (f *fakeEngine) Validate(pdf []byte) error {
	if len(pdf) < 5 || string(pdf[:5]) != "%PDF-" {
		return ErrInvalidPDF
	}
	return nil
}

func (f *fakeEngine) Info(pdf []byte) (PDFInfo, error) { return f.info, nil }

func (f *fakeEngine) mark(pdf []byte, op string) []byte {
	f.applied = append(f.applied, op)
	return append(append([]byte{}, pdf...), []byte("|"+op)...)
}

func (f *fakeEngine) Rotate(pdf []byte, pages []int, degrees int) ([]byte, error) {
	return f.mark(pdf, fmt.Sprintf("rotate%d", degrees)), nil
}

func (f *fakeEngine) DeletePages(pdf []byte, pages []int) ([]byte, error) {
	return f.mark(pdf, "delete"), nil
}

func (f *fakeEngine) Reorder(pdf []byte, order []int) ([]byte, error) {
	return f.mark(pdf, "reorder"), nil
}

func (f *fakeEngine) Merge(pdfs [][]byte) ([]byte, error) {
	return []byte("%PDF-merged"), nil
}

func (f *fakeEngine) ExtractPages(pdf []byte, pages []int) ([]byte, error) {
	return f.mark(pdf, fmt.Sprintf("extract%d", len(pages))), nil
}

func (f *fakeEngine) Annotate(pdf []byte, annots []Annotation) ([]byte, error) {
	return f.mark(pdf, fmt.Sprintf("annotate%d", len(annots))), nil
}

func (f *fakeEngine) StampImage(pdf []byte, page int, rect [4]float64, img []byte) ([]byte, error) {
	return f.mark(pdf, fmt.Sprintf("stamp_p%d", page)), nil
}

func (f *fakeEngine) FormFields(pdf []byte) ([]FormField, error) {
	return []FormField{{ID: "fullName", Type: "text"}}, nil
}

func (f *fakeEngine) FillForm(pdf []byte, values map[string]string) ([]byte, error) {
	if _, ok := values["unknownField"]; ok {
		return nil, fmt.Errorf("%w: unknown form field", ErrInvalidInput)
	}
	return f.mark(pdf, fmt.Sprintf("fill%d", len(values))), nil
}

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
