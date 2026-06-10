package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// pageOpsRequest is the body for POST /documents/:id/pages/ops.
type pageOpsRequest struct {
	Ops []document.PageOp `json:"ops"`
}

// PageOps handles POST /api/v1/documents/:id/pages/ops — applies the given
// operations in order and creates a new version.
func (h *Handlers) PageOps(c *gin.Context) {
	var req pageOpsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fmt.Errorf("%w: bad JSON body: %v", document.ErrInvalidInput, err))
		return
	}
	doc, err := h.svc.ApplyPageOps(c.Request.Context(), c.Param("id"), req.Ops)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}

// insertPagesRequest is the body for POST /documents/:id/pages/insert.
type insertPagesRequest struct {
	At    int    `json:"at"`              // 1-based; pageCount+1 appends at the end
	Count int    `json:"count,omitempty"` // default 1
	Size  string `json:"size,omitempty"`  // e.g. "A4", "Letter"; default: neighbor page size
}

// InsertPages handles POST /api/v1/documents/:id/pages/insert — inserts blank
// pages so the first becomes page `at`, and creates a new version.
func (h *Handlers) InsertPages(c *gin.Context) {
	var req insertPagesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fmt.Errorf("%w: bad JSON body: %v", document.ErrInvalidInput, err))
		return
	}
	doc, err := h.svc.InsertBlankPages(c.Request.Context(), c.Param("id"), req.At, req.Count, req.Size)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}

// appendFromRequest is the body for POST /documents/:id/pages/append-from.
type appendFromRequest struct {
	SourceID string `json:"sourceId"`
	Pages    []int  `json:"pages,omitempty"` // 1-based selection; empty = all
}

// AppendFrom handles POST /api/v1/documents/:id/pages/append-from — appends
// pages of another stored document and creates a new version.
func (h *Handlers) AppendFrom(c *gin.Context) {
	var req appendFromRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fmt.Errorf("%w: bad JSON body: %v", document.ErrInvalidInput, err))
		return
	}
	doc, err := h.svc.AppendFromDocument(c.Request.Context(), c.Param("id"), req.SourceID, req.Pages)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}

// mergeRequest is the body for POST /documents/merge.
type mergeRequest struct {
	IDs  []string `json:"ids"`
	Name string   `json:"name"`
}

// Merge handles POST /api/v1/documents/merge — combines documents into a new one.
func (h *Handlers) Merge(c *gin.Context) {
	var req mergeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fmt.Errorf("%w: bad JSON body: %v", document.ErrInvalidInput, err))
		return
	}
	doc, err := h.svc.Merge(c.Request.Context(), req.IDs, req.Name)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusCreated, doc)
}

// splitRequest is the body for POST /documents/:id/split.
type splitRequest struct {
	Ranges []document.SplitRange `json:"ranges"`
}

// Split handles POST /api/v1/documents/:id/split — extracts page ranges into
// new documents, leaving the source untouched.
func (h *Handlers) Split(c *gin.Context) {
	var req splitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fmt.Errorf("%w: bad JSON body: %v", document.ErrInvalidInput, err))
		return
	}
	docs, err := h.svc.Split(c.Request.Context(), c.Param("id"), req.Ranges)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusCreated, docs)
}
