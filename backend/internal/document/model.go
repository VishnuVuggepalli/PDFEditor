// Package document holds the core domain model and business logic for
// managing PDF documents and their immutable version history.
package document

import "time"

// Version is one immutable snapshot of a document. A new Version is created
// on every mutation; existing versions are never modified.
type Version struct {
	N         int       `json:"n"`
	CreatedAt time.Time `json:"createdAt"`
	Ops       string    `json:"ops"`
	Size      int64     `json:"size"`
	SHA256    string    `json:"sha256"`
}

// Document is the application-owned record of an uploaded PDF.
// PDF-intrinsic facts (page count, form fields) are not stored here; they are
// computed from the PDF bytes on demand so they can never drift stale.
type Document struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	CreatedAt   time.Time `json:"createdAt"`
	HeadVersion int       `json:"headVersion"`
	Versions    []Version `json:"versions"`
}

// Head returns the latest version record.
func (d *Document) Head() Version {
	return d.Versions[len(d.Versions)-1]
}

// PDFInfo is metadata computed live from the PDF bytes.
type PDFInfo struct {
	PageCount int  `json:"pageCount"`
	Encrypted bool `json:"encrypted"`
	HasForm   bool `json:"hasForm"`
}

// Meta combines the application record with PDF-intrinsic metadata for the
// GET /documents/{id}/meta endpoint.
type Meta struct {
	Document Document `json:"document"`
	PDF      PDFInfo  `json:"pdf"`
}
