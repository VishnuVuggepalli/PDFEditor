package api

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// SetThumbs attaches the thumbnail service. Kept separate from NewHandlers so
// the constructor signature (and its existing call sites) stay untouched.
func (h *Handlers) SetThumbs(t *document.ThumbService) {
	h.thumbs = t
}

// Thumbnail handles GET /api/v1/documents/:id/thumbnail?page=1&width=240 —
// responds with a PNG of one page of the head version.
func (h *Handlers) Thumbnail(c *gin.Context) {
	if h.thumbs == nil {
		fail(c, fmt.Errorf("thumbnail service not configured"))
		return
	}
	page, err := positiveQueryInt(c, "page", 1)
	if err != nil {
		fail(c, err)
		return
	}
	width, err := positiveQueryInt(c, "width", document.ThumbDefaultWidth)
	if err != nil {
		fail(c, err)
		return
	}
	// Cap rather than reject: callers asking for more get the largest size served.
	if width > document.ThumbMaxWidth {
		width = document.ThumbMaxWidth
	}

	png, err := h.thumbs.Thumbnail(c.Request.Context(), c.Param("id"), page, width)
	if err != nil {
		fail(c, err)
		return
	}
	// Safe to cache client-side: the frontend version-tags thumbnail URLs
	// (?v=N), so every new head version yields a fresh URL.
	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(http.StatusOK, "image/png", png)
}

// positiveQueryInt parses an optional positive-integer query parameter,
// returning def when absent and ErrInvalidInput when malformed.
func positiveQueryInt(c *gin.Context, key string, def int) (int, error) {
	raw := c.Query(key)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 0, fmt.Errorf("%w: %s must be a positive integer, got %q", document.ErrInvalidInput, key, raw)
	}
	return n, nil
}
