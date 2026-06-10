package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// FormFields handles GET /api/v1/documents/:id/form — lists AcroForm fields.
func (h *Handlers) FormFields(c *gin.Context) {
	fields, err := h.svc.FormFields(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, fields)
}

// fillFormRequest is the body for POST /documents/:id/form.
type fillFormRequest struct {
	Values map[string]string `json:"values"`
}

// FillForm handles POST /api/v1/documents/:id/form — sets field values and
// creates a new version.
func (h *Handlers) FillForm(c *gin.Context) {
	var req fillFormRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fmt.Errorf("%w: bad JSON body: %v", document.ErrInvalidInput, err))
		return
	}
	doc, err := h.svc.FillForm(c.Request.Context(), c.Param("id"), req.Values)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}
