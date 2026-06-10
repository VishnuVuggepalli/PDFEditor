package api

import (
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// contentFormOverhead is headroom for multipart framing on top of the PDF
// size cap.
const contentFormOverhead = 64 << 10

// ReplaceContent handles POST /api/v1/documents/:id/content — accepts a
// complete client-edited PDF and stores it as a new version.
//
// Request: multipart/form-data with
//   - pdf: the edited PDF bytes (max 50 MB)
//
// The bytes are validated server-side before a new version (ops summary
// "content edit") is created.
func (h *Handlers) ReplaceContent(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body,
		document.MaxContentPDFBytes+contentFormOverhead)

	file, _, err := c.Request.FormFile("pdf")
	if err != nil {
		fail(c, fmt.Errorf("%w: missing multipart field 'pdf': %v", document.ErrInvalidInput, err))
		return
	}
	defer file.Close()

	pdf, err := io.ReadAll(file)
	if err != nil {
		fail(c, fmt.Errorf("%w: read pdf: %v", document.ErrInvalidInput, err))
		return
	}

	doc, err := h.svc.ReplaceContent(c.Request.Context(), c.Param("id"), pdf)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}
