package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// stampFormOverhead is headroom for the multipart framing and form fields on
// top of the image size cap.
const stampFormOverhead = 64 << 10

// Stamp handles POST /api/v1/documents/:id/stamp — places a visual signature
// image on one page and creates a new version.
//
// Request: multipart/form-data with
//   - image: the signature file (PNG or JPEG, max 5 MB)
//   - page:  1-based page number, e.g. "3"
//   - rect:  JSON array "[llx,lly,urx,ury]" in PDF points (lower-left origin);
//     the image is fitted into the rect, centered, aspect ratio preserved.
func (h *Handlers) Stamp(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body,
		document.MaxStampImageBytes+stampFormOverhead)

	page, err := strconv.Atoi(c.PostForm("page"))
	if err != nil {
		fail(c, fmt.Errorf("%w: form field 'page' must be a number: %v", document.ErrInvalidInput, err))
		return
	}

	var rect [4]float64
	if err := json.Unmarshal([]byte(c.PostForm("rect")), &rect); err != nil {
		fail(c, fmt.Errorf("%w: form field 'rect' must be JSON [llx,lly,urx,ury]: %v", document.ErrInvalidInput, err))
		return
	}

	file, _, err := c.Request.FormFile("image")
	if err != nil {
		fail(c, fmt.Errorf("%w: missing multipart field 'image': %v", document.ErrInvalidInput, err))
		return
	}
	defer file.Close()

	img, err := io.ReadAll(file)
	if err != nil {
		fail(c, fmt.Errorf("%w: read image: %v", document.ErrInvalidInput, err))
		return
	}

	doc, err := h.svc.StampImage(c.Request.Context(), c.Param("id"), page, rect, img)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}
