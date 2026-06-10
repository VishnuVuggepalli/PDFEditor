// Package store provides the filesystem implementation of document.Store.
//
// Layout on disk (all state lives under the data dir, which is host-mounted
// in Docker so it survives container lifecycles):
//
//	{dataDir}/documents/{uuid}/
//	├── meta.json   application metadata, written atomically
//	├── v1.pdf      original upload — never modified
//	└── vN.pdf      one file per immutable version
package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// FSStore implements document.Store on the local filesystem with an
// in-memory index rebuilt at startup.
type FSStore struct {
	root string // {dataDir}/documents

	mu    sync.RWMutex
	index map[string]*document.Document
}

// NewFSStore creates the layout under dataDir if needed and rebuilds the
// in-memory index by walking existing meta.json files.
func NewFSStore(dataDir string) (*FSStore, error) {
	root := filepath.Join(dataDir, "documents")
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir %s: %w", root, err)
	}
	s := &FSStore{root: root, index: make(map[string]*document.Document)}
	if err := s.rebuildIndex(); err != nil {
		return nil, fmt.Errorf("rebuild index: %w", err)
	}
	return s, nil
}

func (s *FSStore) rebuildIndex() error {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		doc, err := s.readMeta(e.Name())
		if err != nil {
			// Skip corrupt entries rather than refusing to boot; they stay
			// on disk for manual inspection.
			continue
		}
		s.index[doc.ID] = doc
	}
	return nil
}

func (s *FSStore) docDir(id string) string {
	return filepath.Join(s.root, id)
}

func (s *FSStore) versionPath(id string, n int) string {
	return filepath.Join(s.docDir(id), fmt.Sprintf("v%d.pdf", n))
}

func (s *FSStore) readMeta(id string) (*document.Document, error) {
	b, err := os.ReadFile(filepath.Join(s.docDir(id), "meta.json"))
	if err != nil {
		return nil, err
	}
	var doc document.Document
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("parse meta.json for %s: %w", id, err)
	}
	return &doc, nil
}

// writeMetaAtomic writes meta.json via temp file + rename so a crash can
// never leave a half-written file.
func (s *FSStore) writeMetaAtomic(doc *document.Document) error {
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal meta: %w", err)
	}
	dir := s.docDir(doc.ID)
	tmp, err := os.CreateTemp(dir, "meta-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp meta: %w", err)
	}
	defer os.Remove(tmp.Name()) // no-op after successful rename

	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp meta: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp meta: %w", err)
	}
	if err := os.Rename(tmp.Name(), filepath.Join(dir, "meta.json")); err != nil {
		return fmt.Errorf("rename meta: %w", err)
	}
	return nil
}

func newVersion(n int, pdf []byte, ops string) document.Version {
	sum := sha256.Sum256(pdf)
	return document.Version{
		N:         n,
		CreatedAt: time.Now().UTC(),
		Ops:       ops,
		Size:      int64(len(pdf)),
		SHA256:    hex.EncodeToString(sum[:]),
	}
}

// Create stores pdf as version 1 of a brand-new document.
func (s *FSStore) Create(ctx context.Context, name string, pdf []byte) (*document.Document, error) {
	doc := &document.Document{
		ID:          uuid.NewString(),
		Name:        name,
		CreatedAt:   time.Now().UTC(),
		HeadVersion: 1,
		Versions:    []document.Version{newVersion(1, pdf, "upload")},
	}
	if err := os.MkdirAll(s.docDir(doc.ID), 0o755); err != nil {
		return nil, fmt.Errorf("create doc dir: %w", err)
	}
	if err := os.WriteFile(s.versionPath(doc.ID, 1), pdf, 0o644); err != nil {
		return nil, fmt.Errorf("write v1: %w", err)
	}
	if err := s.writeMetaAtomic(doc); err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.index[doc.ID] = doc
	s.mu.Unlock()
	return copyDoc(doc), nil
}

// Get returns the document record from the index.
func (s *FSStore) Get(ctx context.Context, id string) (*document.Document, error) {
	s.mu.RLock()
	doc, ok := s.index[id]
	s.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: %s", document.ErrNotFound, id)
	}
	return copyDoc(doc), nil
}

// List returns all documents, newest first.
func (s *FSStore) List(ctx context.Context) ([]*document.Document, error) {
	s.mu.RLock()
	docs := make([]*document.Document, 0, len(s.index))
	for _, d := range s.index {
		docs = append(docs, copyDoc(d))
	}
	s.mu.RUnlock()

	sort.Slice(docs, func(i, j int) bool {
		return docs[i].CreatedAt.After(docs[j].CreatedAt)
	})
	return docs, nil
}

// VersionBytes returns the raw PDF bytes of version n. Existence is decided
// by the Versions list, not a 1..head range check: per-version deletion may
// leave gaps in the numbering.
func (s *FSStore) VersionBytes(ctx context.Context, id string, n int) ([]byte, error) {
	doc, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if !hasVersion(doc, n) {
		return nil, fmt.Errorf("%w: version %d of %s", document.ErrNotFound, n, id)
	}
	b, err := os.ReadFile(s.versionPath(id, n))
	if err != nil {
		return nil, fmt.Errorf("read v%d of %s: %w", n, id, err)
	}
	return b, nil
}

// AddVersion appends pdf as the new head version.
func (s *FSStore) AddVersion(ctx context.Context, id string, pdf []byte, ops string) (*document.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cur, ok := s.index[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s", document.ErrNotFound, id)
	}

	n := cur.HeadVersion + 1
	if err := os.WriteFile(s.versionPath(id, n), pdf, 0o644); err != nil {
		return nil, fmt.Errorf("write v%d: %w", n, err)
	}

	// Build an updated copy; the indexed record is replaced, never mutated.
	next := copyDoc(cur)
	next.HeadVersion = n
	next.Versions = append(next.Versions, newVersion(n, pdf, ops))
	if err := s.writeMetaAtomic(next); err != nil {
		return nil, err
	}
	s.index[id] = next
	return copyDoc(next), nil
}

// Rename updates the document's display name, persisting meta.json atomically.
func (s *FSStore) Rename(ctx context.Context, id string, name string) (*document.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cur, ok := s.index[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s", document.ErrNotFound, id)
	}

	// Build an updated copy; the indexed record is replaced, never mutated.
	next := copyDoc(cur)
	next.Name = name
	if err := s.writeMetaAtomic(next); err != nil {
		return nil, err
	}
	s.index[id] = next
	return copyDoc(next), nil
}

// Delete removes the document directory and drops it from the index.
func (s *FSStore) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.index[id]; !ok {
		return fmt.Errorf("%w: %s", document.ErrNotFound, id)
	}
	if err := os.RemoveAll(s.docDir(id)); err != nil {
		return fmt.Errorf("remove doc dir %s: %w", id, err)
	}
	delete(s.index, id)
	return nil
}

// DeleteVersion removes one non-head, non-original version: its Versions[]
// entry (numbering gaps are allowed), its vN.pdf, and its cached thumbnails.
// Guards are enforced here, under the store lock, so a concurrent AddVersion
// can never race a head deletion:
//   - v1 (the original upload) can never be deleted
//   - the head version can never be deleted
//   - the only remaining version can never be deleted
//
// meta.json is rewritten atomically before any file is removed, so a crash
// can leave an orphaned vN.pdf at worst — never metadata pointing at a
// missing file.
func (s *FSStore) DeleteVersion(ctx context.Context, id string, n int) (*document.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cur, ok := s.index[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s", document.ErrNotFound, id)
	}
	if !hasVersion(cur, n) {
		return nil, fmt.Errorf("%w: version %d of %s", document.ErrNotFound, n, id)
	}
	if n == 1 {
		return nil, fmt.Errorf("%w: cannot delete v1 (the original upload)", document.ErrInvalidInput)
	}
	if n == cur.HeadVersion {
		return nil, fmt.Errorf("%w: cannot delete the current head version v%d", document.ErrInvalidInput, n)
	}
	if len(cur.Versions) == 1 {
		return nil, fmt.Errorf("%w: cannot delete the only remaining version", document.ErrInvalidInput)
	}

	// Build an updated copy without version n; the indexed record is replaced,
	// never mutated.
	next := copyDoc(cur)
	kept := make([]document.Version, 0, len(next.Versions)-1)
	for _, v := range next.Versions {
		if v.N != n {
			kept = append(kept, v)
		}
	}
	next.Versions = kept
	if err := s.writeMetaAtomic(next); err != nil {
		return nil, err
	}
	s.index[id] = next

	// Metadata is committed; file removal failures leave only orphans, so
	// they are logged rather than surfaced.
	if err := os.Remove(s.versionPath(id, n)); err != nil {
		slog.Warn("remove version file failed", "doc", id, "version", n, "err", err)
	}
	s.removeVersionThumbs(id, n)
	return copyDoc(next), nil
}

// removeVersionThumbs deletes the cached thumbnails of one version:
// {docDir}/thumbs/v{n}-p{page}-w{width}.png (best effort).
func (s *FSStore) removeVersionThumbs(id string, n int) {
	pattern := filepath.Join(s.docDir(id), "thumbs", fmt.Sprintf("v%d-p*-w*.png", n))
	matches, err := filepath.Glob(pattern)
	if err != nil {
		slog.Warn("glob version thumbs failed", "doc", id, "version", n, "err", err)
		return
	}
	for _, m := range matches {
		if err := os.Remove(m); err != nil {
			slog.Warn("remove version thumb failed", "doc", id, "path", m, "err", err)
		}
	}
}

// hasVersion reports whether version n exists in the document's version list.
func hasVersion(d *document.Document, n int) bool {
	for _, v := range d.Versions {
		if v.N == n {
			return true
		}
	}
	return false
}

// copyDoc returns a deep copy so callers can never mutate indexed state.
func copyDoc(d *document.Document) *document.Document {
	cp := *d
	cp.Versions = make([]document.Version, len(d.Versions))
	copy(cp.Versions, d.Versions)
	return &cp
}
