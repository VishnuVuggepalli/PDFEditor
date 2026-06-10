package api

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// Handlers holds the API's dependencies.
type Handlers struct {
	svc       *document.Service
	thumbs    *document.ThumbService // optional; attached via SetThumbs
	maxUpload int64
}

// NewHandlers wires the handler set.
func NewHandlers(svc *document.Service, maxUploadBytes int64) *Handlers {
	return &Handlers{svc: svc, maxUpload: maxUploadBytes}
}

// Upload handles POST /api/v1/documents (multipart field "file").
func (h *Handlers) Upload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.maxUpload)

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		fail(c, fmt.Errorf("%w: missing multipart field 'file': %v", document.ErrInvalidInput, err))
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		fail(c, fmt.Errorf("%w: read upload: %v", document.ErrInvalidInput, err))
		return
	}

	doc, err := h.svc.Upload(c.Request.Context(), header.Filename, data)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusCreated, doc)
}

// List handles GET /api/v1/documents.
func (h *Handlers) List(c *gin.Context) {
	docs, err := h.svc.List(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, docs)
}

// Download handles GET /api/v1/documents/:id — streams the head version.
func (h *Handlers) Download(c *gin.Context) {
	b, doc, err := h.svc.Download(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.Header("Content-Disposition", contentDisposition("inline", doc.Name))
	c.Data(http.StatusOK, "application/pdf", b)
}

// contentDisposition builds an RFC 6266 Content-Disposition header value.
// mime.FormatMediaType quotes ASCII filenames and switches to the RFC 5987
// extended form (filename*=utf-8”...) for non-ASCII ones, so names are never
// emitted raw into the header.
func contentDisposition(disposition, filename string) string {
	if v := mime.FormatMediaType(disposition, map[string]string{"filename": filename}); v != "" {
		return v
	}
	// Unrepresentable name (should not happen): fall back to a safe constant.
	return disposition + `; filename="document.pdf"`
}

// renameRequest is the body for PATCH /api/v1/documents/:id.
type renameRequest struct {
	Name string `json:"name"`
}

// Rename handles PATCH /api/v1/documents/:id — updates the display name.
func (h *Handlers) Rename(c *gin.Context) {
	var req renameRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fmt.Errorf("%w: body must be JSON {\"name\": string}: %v", document.ErrInvalidInput, err))
		return
	}
	doc, err := h.svc.Rename(c.Request.Context(), c.Param("id"), req.Name)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}

// Delete handles DELETE /api/v1/documents/:id.
func (h *Handlers) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, gin.H{"deleted": c.Param("id")})
}

// Meta handles GET /api/v1/documents/:id/meta.
func (h *Handlers) Meta(c *gin.Context) {
	meta, err := h.svc.Meta(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, meta)
}

// ListVersions handles GET /api/v1/documents/:id/versions.
func (h *Handlers) ListVersions(c *gin.Context) {
	doc, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc.Versions)
}

// DownloadVersion handles GET /api/v1/documents/:id/versions/:n.
func (h *Handlers) DownloadVersion(c *gin.Context) {
	n, err := strconv.Atoi(c.Param("n"))
	if err != nil {
		fail(c, fmt.Errorf("%w: version must be a number", document.ErrInvalidInput))
		return
	}
	b, err := h.svc.DownloadVersion(c.Request.Context(), c.Param("id"), n)
	if err != nil {
		fail(c, err)
		return
	}
	c.Data(http.StatusOK, "application/pdf", b)
}

// RestoreVersion handles POST /api/v1/documents/:id/versions/:n/restore.
func (h *Handlers) RestoreVersion(c *gin.Context) {
	n, err := strconv.Atoi(c.Param("n"))
	if err != nil {
		fail(c, fmt.Errorf("%w: version must be a number", document.ErrInvalidInput))
		return
	}
	doc, err := h.svc.RestoreVersion(c.Request.Context(), c.Param("id"), n)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, http.StatusOK, doc)
}
