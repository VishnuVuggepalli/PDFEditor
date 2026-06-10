package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// annotateRequest is the body for POST /documents/:id/annotations.
type annotateRequest struct {
	Annotations []document.Annotation `json:"annotations"`
}

// Annotate handles POST /api/v1/documents/:id/annotations — embeds the given
// annotations and creates a new version.
func (h *Handlers) Annotate(c *gin.Context) {
	var req annotateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fmt.Errorf("%w: bad JSON body: %v", document.ErrInvalidInput, err))
		return
	}
	doc, err := h.svc.Annotate(c.Request.Context(), c.Param("id"), req.Annotations)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}
