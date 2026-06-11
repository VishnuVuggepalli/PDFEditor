package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// signBody is the request payload for POST /documents/:id/sign.
// visibleRect and page must be provided together; when present a visible
// signature widget (signer name + date) is placed there, otherwise the
// signature is invisible.
type signBody struct {
	Reason      string      `json:"reason"`
	Location    string      `json:"location"`
	Page        *int        `json:"page"`
	VisibleRect *[4]float64 `json:"visibleRect"`
}

// Sign handles POST /api/v1/documents/:id/sign — cryptographically signs
// the head version and creates a new version ("digitally signed").
func (h *Handlers) Sign(c *gin.Context) {
	var body signBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fmt.Errorf("%w: invalid JSON body: %v", document.ErrInvalidInput, err))
		return
	}
	if (body.VisibleRect == nil) != (body.Page == nil) {
		fail(c, fmt.Errorf("%w: visibleRect and page must be provided together", document.ErrInvalidInput))
		return
	}

	req := document.SignRequest{Reason: body.Reason, Location: body.Location}
	if body.VisibleRect != nil {
		req.Visible = true
		req.Page = *body.Page
		req.Rect = *body.VisibleRect
	}

	doc, err := h.svc.Sign(c.Request.Context(), c.Param("id"), req)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}

// Signatures handles GET /api/v1/documents/:id/signatures — the validation
// status of every digital signature in the head version.
func (h *Handlers) Signatures(c *gin.Context) {
	infos, err := h.svc.Signatures(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, infos)
}
