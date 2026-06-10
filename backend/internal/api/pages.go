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
