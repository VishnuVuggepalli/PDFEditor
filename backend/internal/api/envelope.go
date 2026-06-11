// Package api is the HTTP layer. Gin is confined to this package; handlers
// translate HTTP to service calls and service errors back to HTTP.
package api

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// Envelope is the uniform response shape for every JSON endpoint.
type Envelope struct {
	Success bool   `json:"success"`
	Data    any    `json:"data"`
	Error   string `json:"error,omitempty"`
}

// ok writes a success envelope.
func ok(c *gin.Context, status int, data any) {
	c.JSON(status, Envelope{Success: true, Data: data})
}

// fail maps a service error to an HTTP status with a user-friendly message,
// logging full detail server-side.
func fail(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	msg := "internal error"

	switch {
	case errors.Is(err, document.ErrNotFound):
		status, msg = http.StatusNotFound, "document or version not found"
	case errors.Is(err, document.ErrInvalidPDF):
		status, msg = http.StatusUnprocessableEntity, "file is not a valid PDF"
	case errors.Is(err, document.ErrInvalidInput):
		status, msg = http.StatusBadRequest, "invalid input"
	case errors.Is(err, document.ErrSigningUnavailable):
		status, msg = http.StatusServiceUnavailable, "digital signing is not available on this server"
	}

	slog.Error("request failed",
		"method", c.Request.Method,
		"path", c.Request.URL.Path,
		"status", status,
		"err", err,
	)
	c.JSON(status, Envelope{Success: false, Error: msg})
}
